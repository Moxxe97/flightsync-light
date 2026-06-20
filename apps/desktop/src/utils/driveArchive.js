// Drive-native backup of archived years. Pure helpers here are unit-tested;
// the Drive ops + orchestration (added below) are fetch/idb-mocked in tests.

import { ensureAccessToken } from './cloudAuth';
import { getOFPBytes, getBoardingPassesForDate, saveArchiveYear, saveOFP, saveBoardingPass } from '@flightsync/core/idb';

// FNV-1a 32-bit hash over the year's content. Stable for unchanged data, used
// to decide whether a year needs re-uploading. Only flights/residence/manifest
// participate — archivedAt and other metadata must not affect it.
export function contentHash(record) {
  const s = JSON.stringify({
    flights: record.flights || [],
    residence: record.residence || [],
    manifest: record.manifest || null,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// The object written as year.json on Drive.
export function buildYearJson(record, hash) {
  return {
    year: record.year,
    flights: record.flights || [],
    residence: record.residence || [],
    manifest: record.manifest || null,
    archivedAt: record.archivedAt || null,
    contentHash: hash,
  };
}

// Validates the parsed year.json shape before anything touches IDB (audit
// #24/G1). Returns null when valid, else a short French reason.
export function validateYearJson(record) {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return 'year.json invalide — pas un objet';
  if (typeof record.year !== 'string' && typeof record.year !== 'number') return 'year.json invalide — year manquant';
  if (!Array.isArray(record.flights)) return 'year.json invalide — flights doit être une liste';
  if (!Array.isArray(record.residence)) return 'year.json invalide — residence doit être une liste';
  if (record.manifest != null && (typeof record.manifest !== 'object' || Array.isArray(record.manifest))) return 'year.json invalide — manifest invalide';
  if (typeof record.contentHash !== 'string') return 'year.json invalide — contentHash manquant';
  return null;
}

export function extFromMime(mime) {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  return 'bin';
}

export function ofpFileName(flightId) {
  return `ofp-${flightId}.pdf`;
}

export function bpFileName(date, n, ext) {
  return `bp-${date}-${n}.${ext}`;
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function authHeader() {
  const token = await ensureAccessToken();
  if (!token) throw new Error('Non authentifié Google');
  return { Authorization: `Bearer ${token}` };
}

async function driveSearch(q, fields = 'files(id,name)') {
  const url = `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&spaces=drive`;
  const res = await fetch(url, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Drive search failed: HTTP ${res.status}`);
  const { files } = await res.json();
  return files || [];
}

// Find a folder by name (optionally within a parent), creating it if absent.
export async function ensureFolder(name, parentId) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const found = await driveSearch(`name='${name}' and mimeType='${FOLDER_MIME}' and trashed=false${parentClause}`);
  if (found[0]) return found[0].id;
  const metadata = { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) };
  const res = await fetch(`${DRIVE_API}?fields=id`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) throw new Error(`Drive folder create '${name}' failed: HTTP ${res.status}`);
  return (await res.json()).id;
}

// Create or overwrite a file (by name) inside parentId; returns its id. CONTENT
// ONLY — custom metadata (appProperties) is set separately via
// setFileAppProperties so a marker is never written before its content is
// durable. On update: media PATCH. On create: atomic multipart POST.
export async function uploadFile(parentId, name, blob, mimeType) {
  const existing = (await driveSearch(`name='${name}' and '${parentId}' in parents and trashed=false`, 'files(id)'))[0];
  if (existing) {
    const res = await fetch(`${DRIVE_UPLOAD_API}/${existing.id}?uploadType=media`, {
      method: 'PATCH',
      headers: { ...(await authHeader()), 'Content-Type': mimeType },
      body: blob,
    });
    if (!res.ok) throw new Error(`Drive update '${name}' failed: HTTP ${res.status}`);
    return existing.id;
  }
  const metadata = { name, parents: [parentId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  const res = await fetch(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: await authHeader(),
    body: form,
  });
  if (!res.ok) throw new Error(`Drive create '${name}' failed: HTTP ${res.status}`);
  return (await res.json()).id;
}

// Stamp custom appProperties on a file (used for year.json's contentHash, set
// only AFTER content is durably uploaded — so a matching hash never coexists
// with stale/partial content, preventing a false "skip" on the next backup).
export async function setFileAppProperties(fileId, appProperties) {
  const res = await fetch(`${DRIVE_API}/${fileId}`, {
    method: 'PATCH',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ appProperties }),
  });
  if (!res.ok) throw new Error(`Drive metadata update failed: HTTP ${res.status}`);
  return fileId;
}

const ROOT_FOLDER_NAME = 'FlightSync Light Archives';

// Gather a year's OFP + boarding-pass files (as Blobs) from IndexedDB, named
// for Drive. Entries without stored bytes are skipped.
export async function collectYearAssets(record) {
  const assets = [];
  for (const flightId of record.manifest?.ofpFlightIds || []) {
    const bytes = await getOFPBytes(flightId);
    if (!bytes) continue;
    assets.push({ name: ofpFileName(flightId), mimeType: 'application/pdf', blob: new Blob([bytes], { type: 'application/pdf' }) });
  }
  for (const date of record.manifest?.bpDates || []) {
    const bps = await getBoardingPassesForDate(date);
    bps.forEach((bp, i) => {
      if (!bp.data) return;
      const mime = bp.fileType || 'application/octet-stream';
      assets.push({ name: bpFileName(date, i, extFromMime(mime)), mimeType: mime, blob: new Blob([bp.data], { type: mime }) });
    });
  }
  return assets;
}

async function remoteYearHash(yearFolderId) {
  const f = (await driveSearch(`name='year.json' and '${yearFolderId}' in parents and trashed=false`, 'files(id,appProperties)'))[0];
  return f?.appProperties?.contentHash || null;
}

// Back up one year to Drive. Idempotent: if the remote year.json's contentHash
// matches the local content, nothing is uploaded. Otherwise assets are uploaded
// first, then year.json content, then the hash is stamped LAST (so a partial
// upload never leaves a matching hash on stale content).
export async function backupYearToDrive(record) {
  const hash = contentHash(record);
  const rootId = await ensureFolder(ROOT_FOLDER_NAME, null);
  const yearId = await ensureFolder(record.year, rootId);
  if ((await remoteYearHash(yearId)) === hash) {
    return { status: 'skipped', year: record.year };
  }
  const assets = await collectYearAssets(record);
  for (const a of assets) {
    await uploadFile(yearId, a.name, a.blob, a.mimeType);
  }
  const yearBlob = new Blob([JSON.stringify(buildYearJson(record, hash), null, 2)], { type: 'application/json' });
  const yearFileId = await uploadFile(yearId, 'year.json', yearBlob, 'application/json');
  await setFileAppProperties(yearFileId, { contentHash: hash });
  return { status: 'backed-up', year: record.year, files: assets.length + 1 };
}

// Back up many years; one year's failure doesn't abort the rest.
export async function backupAllYears(records) {
  const results = [];
  for (const r of records) {
    try {
      results.push(await backupYearToDrive(r));
    } catch (err) {
      results.push({ status: 'error', year: r.year, error: err.message });
    }
  }
  return results;
}

// Find a folder by name (optionally in a parent) WITHOUT creating it.
export async function findFolder(name, parentId) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const found = await driveSearch(`name='${name}' and mimeType='${FOLDER_MIME}' and trashed=false${parentClause}`);
  return found[0]?.id || null;
}

// List the archived years present on Drive as [{year, folderId}], newest-first.
// Returns [] if the root archive folder doesn't exist yet.
export async function listDriveArchiveYears() {
  const rootId = await findFolder(ROOT_FOLDER_NAME, null);
  if (!rootId) return [];
  const subfolders = await driveSearch(`mimeType='${FOLDER_MIME}' and '${rootId}' in parents and trashed=false`, 'files(id,name)');
  return subfolders
    .map((f) => ({ year: f.name, folderId: f.id }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

// Download a Drive file's raw bytes as a Uint8Array.
export async function downloadFileBytes(fileId) {
  const res = await fetch(`${DRIVE_API}/${fileId}?alt=media`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Drive download ${fileId} failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Restore one archived year from Drive into local idb. Additive + re-runnable:
// the year record + OFPs are upserted; boarding passes are added only if no
// existing BP for the date already has the same fileName.
export async function downloadYear({ year, folderId }) {
  const files = await driveSearch(`'${folderId}' in parents and trashed=false`, 'files(id,name)');
  const byName = new Map(files.map((f) => [f.name, f.id]));

  const jsonId = byName.get('year.json');
  if (!jsonId) throw new Error(`year.json missing for ${year}`);
  const jsonBytes = await downloadFileBytes(jsonId);
  const record = JSON.parse(new TextDecoder().decode(jsonBytes));
  const invalid = validateYearJson(record);
  if (invalid) throw new Error(`${invalid} (${year})`);
  // The hash is computed over {flights, residence, manifest} exactly as on
  // upload — a mismatch means the file was corrupted or edited on Drive.
  const expectedHash = record.contentHash;
  const actualHash = contentHash(record);
  if (actualHash !== expectedHash) {
    throw new Error(`contentHash mismatch pour ${year}: attendu ${expectedHash}, calculé ${actualHash}`);
  }
  const flights = record.flights || [];
  const manifest = record.manifest || { ofpFlightIds: [], bpDates: [] };

  // 1) the archive year record (Drive is source of truth → overwrite)
  await saveArchiveYear({
    year: record.year,
    flights,
    residence: record.residence || [],
    manifest,
    archivedAt: record.archivedAt || null,
  });

  // 2) OFPs (upsert by flightId)
  let ofps = 0;
  for (const flightId of manifest.ofpFlightIds || []) {
    const fid = byName.get(ofpFileName(flightId));
    if (!fid) continue;
    const bytes = await downloadFileBytes(fid);
    const flight = flights.find((f) => f.id === flightId) || {};
    await saveOFP(flightId, { date: flight.date, flightNumber: flight.flightNumber, fileName: ofpFileName(flightId), data: bytes, pageCount: null });
    ofps++;
  }

  // 3) boarding passes (add unless an identical fileName already exists for the date)
  let boardingPasses = 0;
  for (const date of manifest.bpDates || []) {
    const prefix = `bp-${date}-`;
    const existing = await getBoardingPassesForDate(date);
    const existingNames = new Set(existing.map((b) => b.fileName));
    for (const [name, id] of byName) {
      if (!name.startsWith(prefix)) continue;
      if (existingNames.has(name)) continue;
      const bytes = await downloadFileBytes(id);
      const ext = name.split('.').pop();
      const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'application/octet-stream';
      await saveBoardingPass(date, new File([bytes], name, { type: mime }));
      boardingPasses++;
    }
  }

  return { year: record.year, flights: flights.length, ofps, boardingPasses };
}

// Restore every archived year found on Drive. One year's failure doesn't abort
// the rest. Returns per-year results.
export async function restoreAllFromDrive() {
  const years = await listDriveArchiveYears();
  const results = [];
  for (const y of years) {
    try {
      results.push({ status: 'restored', ...(await downloadYear(y)) });
    } catch (err) {
      results.push({ status: 'error', year: y.year, error: err.message });
    }
  }
  return results;
}
