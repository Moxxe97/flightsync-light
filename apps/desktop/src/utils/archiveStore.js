// Per-year archive storage. Pure helpers here are unit-tested; the idb-backed
// ops (added below) wrap the flight-sync-archive repo.

import { getArchiveYear, saveArchiveYear, getAllArchiveYears } from '@flightsync/core/idb';

export const ARCHIVE_SCHEMA = 1;

const FLIGHTS_KEY_RE = /^ac-flights-archive-(\d{4})$/;
const RESIDENCE_KEY_RE = /^ac-residence-archive-(\d{4})$/;

// Classify a legacy localStorage archive key (used by the migration).
export function parseArchiveKey(key) {
  if (typeof key !== 'string') return null;
  let m = key.match(FLIGHTS_KEY_RE);
  if (m) return { kind: 'flights', year: m[1] };
  m = key.match(RESIDENCE_KEY_RE);
  if (m) return { kind: 'residence', year: m[1] };
  return null;
}

// Summarize a year's data. ofpFlightIds/bpDates are app-wide; we keep only the
// ones that belong to this year (flights owned by the year; bp dates in the year).
export function buildManifest({ year, flights = [], residence = [], ofpFlightIds = [], bpDates = [] }) {
  const flightDates = flights.map((f) => f.date).filter(Boolean).slice().sort();
  const ofpSet = new Set(ofpFlightIds);
  return {
    schema: ARCHIVE_SCHEMA,
    flightCount: flights.length,
    residenceDays: residence.length,
    dateRange: flightDates.length ? { from: flightDates[0], to: flightDates[flightDates.length - 1] } : null,
    ofpFlightIds: flights.map((f) => f.id).filter((id) => ofpSet.has(id)),
    bpDates: bpDates.filter((d) => typeof d === 'string' && d.startsWith(year)),
  };
}

function dedupeBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (k == null) { out.push(x); continue; }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// Merge an incoming year's data into an existing archive record. Existing entries
// win on conflict (flights keyed by id, residence by date) — matches the legacy
// localStorage merge behaviour.
export function mergeYearData(existing, incoming) {
  const flights = dedupeBy([...(existing?.flights || []), ...(incoming.flights || [])], (f) => f.id);
  const residence = dedupeBy([...(existing?.residence || []), ...(incoming.residence || [])], (r) => r.date);
  return { flights, residence };
}

// ─── idb-backed ops ──────────────────────────────────────────

// All archived years as [{year, flights, residence, manifest}], newest first.
// Shape stays compatible with Phase 1's selectDisplayData/archiveYearList.
export async function listArchiveYears() {
  const recs = await getAllArchiveYears();
  return recs
    .map((r) => ({ year: r.year, flights: r.flights || [], residence: r.residence || [], manifest: r.manifest || null, archivedAt: r.archivedAt || null }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

// Merge a year's data into the store (creating or updating the record) and
// rebuild its manifest. ofpFlightIds/bpDates are app-wide id/date lists.
export async function saveYearToArchive(year, { flights = [], residence = [], ofpFlightIds = [], bpDates = [] }) {
  const existing = await getArchiveYear(year);
  const merged = mergeYearData(existing, { flights, residence });
  const manifest = buildManifest({ year, flights: merged.flights, residence: merged.residence, ofpFlightIds, bpDates });
  await saveArchiveYear({ year, flights: merged.flights, residence: merged.residence, manifest, archivedAt: new Date().toISOString() });
}

// One-time migration: move legacy ac-*-archive-<year> localStorage entries into
// the IndexedDB store, then remove the localStorage keys. Idempotent — a second
// run finds no keys and does nothing. Returns the number of years migrated.
export async function migrateLocalStorageArchives({ ofpFlightIds = [], bpDates = [] } = {}) {
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  const years = new Set();
  for (const key of keys) {
    const parsed = parseArchiveKey(key);
    if (parsed) years.add(parsed.year);
  }
  if (years.size === 0) return 0;
  let migrated = 0;
  for (const year of years) {
    const flights = JSON.parse(localStorage.getItem(`ac-flights-archive-${year}`) || '[]');
    const residence = JSON.parse(localStorage.getItem(`ac-residence-archive-${year}`) || '[]');
    try {
      await saveYearToArchive(year, { flights, residence, ofpFlightIds, bpDates });
    } catch (err) {
      // NEVER delete the localStorage source before the IndexedDB write is
      // durable. On failure, keep the keys so a later run retries this year.
      console.warn(`[archive] migration of ${year} failed, keeping localStorage:`, err.message);
      continue;
    }
    localStorage.removeItem(`ac-flights-archive-${year}`);
    localStorage.removeItem(`ac-residence-archive-${year}`);
    migrated++;
  }
  return migrated;
}
