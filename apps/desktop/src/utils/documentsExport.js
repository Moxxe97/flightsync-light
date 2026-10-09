// Per-year export of stored flight documents (OFP PDFs + boarding passes)
// as one ZIP — for audits and record requests (e.g. CRA), so the app is the
// only place the documents need to live.
//
// The planning half (documentYears / buildDocumentsPlan) is pure and
// unit-tested; exportDocumentsZip does the idb reads, zips with fflate and
// hands the bytes to saveExportFile.
import { zipSync } from 'fflate';
import {
  getAllOFPFlightIds, getOFP,
  getAllBoardingPassDates, getBoardingPassesForDate,
} from '@flightsync/core/idb';
import { saveExportFile } from './saveExportFile';

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function sanitize(s) {
  return String(s || '').replace(/[^A-Za-z0-9_-]/g, '');
}

function passExt({ fileName, fileType }) {
  const fromName = String(fileName || '').match(/\.([A-Za-z0-9]{2,5})$/)?.[1]?.toLowerCase();
  if (fromName && fromName !== 'jpeg') return fromName;
  if (fromName === 'jpeg') return 'jpg';
  return EXT_BY_MIME[fileType] || 'bin';
}

// Distinct years that have at least one stored document, newest first.
export function documentYears({ ofpMetas, bps }) {
  const years = new Set();
  for (const m of ofpMetas) if (m?.date) years.add(String(m.date).slice(0, 4));
  for (const b of bps) if (b?.date) years.add(String(b.date).slice(0, 4));
  return [...years].sort().reverse();
}

// Pure plan: which documents go in the ZIP and under which paths, plus the
// manifest text an auditor reads first.
export function buildDocumentsPlan(year, { ofpMetas, bps, flights }) {
  const inYear = (d) => String(d || '').startsWith(`${year}-`);
  const byId = new Map(flights.map((f) => [f.id, f]));

  const usedNames = new Map(); // base path -> count
  const unique = (base, ext) => {
    const n = (usedNames.get(base) || 0) + 1;
    usedNames.set(base, n);
    return n === 1 ? `${base}.${ext}` : `${base}-${n}.${ext}`;
  };

  const ofps = ofpMetas
    .filter((m) => inYear(m.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((m) => ({
      flightId: m.flightId,
      path: unique(`ofps/${m.date}-${sanitize(m.flightNumber)}`, 'pdf'),
    }));

  const perDate = new Map(); // date -> running index
  const passes = bps
    .filter((b) => inYear(b.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id ?? 0) - (b.id ?? 0)))
    .map((b) => {
      const n = (perDate.get(b.date) || 0) + 1;
      perDate.set(b.date, n);
      return { id: b.id, path: `boarding-passes/${b.date}-${n}.${passExt(b)}` };
    });

  const lines = [];
  lines.push(`FlightSync Light — flight documents for ${year}`);
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`Contents: ${ofps.length} flight plans (OFP), ${passes.length} boarding passes`);
  lines.push('');
  if (ofps.length) {
    lines.push('FLIGHT PLANS (ofps/)');
    for (const o of ofps) {
      const meta = ofpMetas.find((m) => m.flightId === o.flightId);
      const f = byId.get(o.flightId);
      const route = f ? ` ${f.departure}-${f.arrival}` : '';
      lines.push(`  ${o.path} — ${meta.date} ${meta.flightNumber}${route}`);
    }
    lines.push('');
  }
  if (passes.length) {
    lines.push('BOARDING PASSES (boarding-passes/)');
    for (const p of passes) lines.push(`  ${p.path}`);
    lines.push('');
  }

  return {
    zipName: `FlightSync-Documents-${year}.zip`,
    ofps,
    passes,
    manifest: lines.join('\n'),
  };
}

// Reads the metadata needed for the year picker and the plan.
export async function loadDocumentIndex() {
  const ofpMetas = [];
  for (const flightId of await getAllOFPFlightIds()) {
    const rec = await getOFP(flightId);
    if (rec) ofpMetas.push({ flightId, date: rec.date, flightNumber: rec.flightNumber });
  }
  const bps = [];
  for (const date of await getAllBoardingPassDates()) {
    for (const rec of await getBoardingPassesForDate(date)) {
      bps.push({ id: rec.id, date: rec.date, fileName: rec.fileName, fileType: rec.fileType });
    }
  }
  return { ofpMetas, bps };
}

// Assemble and save the ZIP for one year. Returns saveExportFile's result.
export async function exportDocumentsZip(year, { ofpMetas, bps, flights }) {
  const plan = buildDocumentsPlan(year, { ofpMetas, bps, flights });
  const entries = { 'manifest.txt': new TextEncoder().encode(plan.manifest) };
  for (const o of plan.ofps) {
    const rec = await getOFP(o.flightId);
    if (rec?.data) entries[o.path] = new Uint8Array(rec.data);
  }
  const byDate = new Map();
  for (const p of plan.passes) {
    const date = p.path.split('/')[1].slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, await getBoardingPassesForDate(date));
    const rec = byDate.get(date).find((r) => r.id === p.id);
    if (rec?.data) entries[p.path] = new Uint8Array(rec.data);
  }
  // PDFs and images are already compressed — store-level zip keeps it fast.
  const zipped = zipSync(entries, { level: 0 });
  return saveExportFile(plan.zipName, zipped, 'application/zip');
}
