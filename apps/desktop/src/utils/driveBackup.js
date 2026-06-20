// TODO(post-Task-10): consolidate the Drive REST helpers with driveArchive.js once both call patterns are frozen.
// FlightSync Light — disaster-recovery backup to the pilot's own Google Drive
// (drive.file scope: the app sees only files it created). One JSON snapshot,
// updated in place (Drive keeps ~30 days of revisions for free), plus the
// source PDFs (OFPs / boarding passes) uploaded once each, immutable.
import { ensureAccessToken } from './cloudAuth';
import {
  getAllOFPFlightIds,
  getOFPBytes,
  getAllBoardingPassDates,
  getBoardingPassesForDate,
  saveOFP,
  saveBoardingPass,
} from '@flightsync/core/idb';
import { ofpFileName, bpFileName, extFromMime } from './driveArchive';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
export const BACKUP_FOLDER = 'FlightSync Light';
export const BACKUP_FILENAME = 'flightsync-light-backup.json';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function requireToken() {
  const token = await ensureAccessToken();
  if (!token) throw new Error('Non authentifié Google');
  return token;
}

async function driveFetch(token, url, init = {}) {
  const doFetch = (tok) => fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, ...(init.headers || {}) },
  });
  let res = await doFetch(token);
  // Cheap one-shot 401 recovery: the cached access token may have gone stale
  // earlier than its tracked expiry (e.g. revoked/rotated server-side). Ask
  // cloudAuth for a token again; ensureAccessToken refreshes it once the cache
  // is considered expired. Only worth retrying if we actually get a *different*
  // token — an identical one would just 401 again, so we throw instead.
  if (res.status === 401) {
    const fresh = await ensureAccessToken();
    if (fresh && fresh !== token) res = await doFetch(fresh);
  }
  if (!res.ok) throw new Error(`Drive: HTTP ${res.status}`);
  return res.json();
}

async function findByName(token, name, { parentId, mimeType } = {}) {
  let q = `name='${name.replace(/'/g, "\\'")}' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  if (mimeType) q += ` and mimeType='${mimeType}'`;
  const data = await driveFetch(
    token,
    `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
  );
  return data.files?.[0]?.id || null;
}

async function ensureFolder(token, name, parentId = null) {
  const existing = await findByName(token, name, { parentId, mimeType: FOLDER_MIME });
  if (existing) return existing;
  const body = { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) };
  const created = await driveFetch(token, DRIVE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return created.id;
}

async function uploadFile(token, { name, parentId, blob, mimeType }) {
  const metadata = { name, mimeType, parents: [parentId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  return driveFetch(token, `${DRIVE_UPLOAD_API}?uploadType=multipart`, { method: 'POST', body: form });
}

async function listFiles(token, parentId) {
  const files = [];
  let pageToken = '';
  do {
    const url = `${DRIVE_API}?q=${encodeURIComponent(`'${parentId}' in parents and trashed=false`)}` +
      `&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const data = await driveFetch(token, url);
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

export function buildBackupPayload({ flights, residence, settings }) {
  // backupFolder is a machine-specific absolute path (contains the macOS
  // username) — never serialize it into a backup that may leave this Mac.
  const { backupFolder: _machineLocal, ...safeSettings } = settings || {};
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    flights,
    residence,
    settings: safeSettings,
  };
}

// Upload-once blob mirror: anything already named in the subfolder is skipped.
async function backupBlobs(token, folderId) {
  const ofpFolder = await ensureFolder(token, 'ofps', folderId);
  const bpFolder = await ensureFolder(token, 'boarding-passes', folderId);
  const ofpExisting = new Set((await listFiles(token, ofpFolder)).map((f) => f.name));
  const bpExisting = new Set((await listFiles(token, bpFolder)).map((f) => f.name));

  for (const flightId of await getAllOFPFlightIds()) {
    const name = ofpFileName(flightId);
    if (ofpExisting.has(name)) continue;
    const ofp = await getOFPBytes(flightId);
    if (!ofp) continue;
    await uploadFile(token, {
      name, parentId: ofpFolder, mimeType: 'application/pdf',
      blob: new Blob([ofp], { type: 'application/pdf' }),
    });
  }

  // Per-date iteration so the index `n` in bpFileName is STABLE: it counts
  // within a single date, not across the whole flat array. A global index
  // (getAllBoardingPasses) shifts every later pass whenever any pass is
  // added/removed, re-uploading them under new names on each backup (unbounded
  // Drive growth) and producing duplicate restores. This mirrors
  // driveArchive.js collectYearAssets. Per-date indexes stay stable as long as
  // passes for a given date aren't reordered.
  for (const date of await getAllBoardingPassDates()) {
    const passes = await getBoardingPassesForDate(date);
    for (let n = 0; n < passes.length; n++) {
      const bp = passes[n];
      if (!bp?.data) continue;
      // Boarding-pass records store their MIME under `fileType` (see
      // boarding-passes-repo.js), not `mimeType`.
      const mime = bp.fileType || 'application/pdf';
      const name = bpFileName(date, n, extFromMime(mime));
      if (bpExisting.has(name)) continue;
      await uploadFile(token, {
        name, parentId: bpFolder, mimeType: mime,
        blob: new Blob([bp.data], { type: mime }),
      });
    }
  }
}

export async function runBackup({ flights, residence, settings, includeBlobs = false }) {
  const token = await requireToken();
  const folderId = await ensureFolder(token, BACKUP_FOLDER);

  const payload = buildBackupPayload({ flights, residence, settings });
  const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const existingId = await findByName(token, BACKUP_FILENAME, { parentId: folderId });
  if (existingId) {
    await driveFetch(token, `${DRIVE_UPLOAD_API}/${existingId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: jsonBlob,
    });
  } else {
    await uploadFile(token, {
      name: BACKUP_FILENAME, parentId: folderId,
      mimeType: 'application/json', blob: jsonBlob,
    });
  }

  if (includeBlobs) await backupBlobs(token, folderId);
}

// Returns { fileId } when a backup exists on the signed-in account, else null.
export async function findBackup() {
  const token = await requireToken();
  const folderId = await findByName(token, BACKUP_FOLDER, { mimeType: FOLDER_MIME });
  if (!folderId) return null;
  const fileId = await findByName(token, BACKUP_FILENAME, { parentId: folderId });
  return fileId ? { fileId } : null;
}

export async function downloadBackup(fileId) {
  const token = await requireToken();
  const res = await fetch(`${DRIVE_API}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive download: HTTP ${res.status}`);
  return res.text(); // validated by importValidation.parseBackupJson at the call site
}

async function downloadBytes(token, fileId) {
  const res = await fetch(`${DRIVE_API}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive download: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Re-download the PDF mirror after a JSON restore (new-Mac scenario). OFP files
// are named `ofp-${flightId}.pdf` (ofpFileName) and boarding passes
// `bp-${date}-${n}.${ext}` (bpFileName); flight metadata for saveOFP comes from
// the restored flights list. Mirrors the per-file logic of driveArchive's
// downloadYear (saveOFP(flightId, {...}); saveBoardingPass(date, File)).
export async function restoreBlobs(restoredFlights) {
  const token = await requireToken();
  const folderId = await findByName(token, BACKUP_FOLDER, { mimeType: FOLDER_MIME });
  if (!folderId) return { ofps: 0, boardingPasses: 0 };
  const byId = new Map((restoredFlights || []).map((f) => [f.id, f]));
  let ofps = 0;
  let boardingPasses = 0;

  const ofpFolder = await findByName(token, 'ofps', { parentId: folderId, mimeType: FOLDER_MIME });
  if (ofpFolder) {
    for (const file of await listFiles(token, ofpFolder)) {
      // ofpFileName → `ofp-${flightId}.pdf`; reverse the prefix + extension.
      const flightId = file.name.replace(/^ofp-/, '').replace(/\.pdf$/i, '');
      const flight = byId.get(flightId);
      if (!flight) continue; // blob without a restored flight row — leave it on Drive
      const bytes = await downloadBytes(token, file.id);
      await saveOFP(flightId, {
        date: flight.date,
        flightNumber: flight.flightNumber,
        fileName: file.name,
        data: bytes,
        pageCount: null,
      });
      ofps++;
    }
  }

  const bpFolder = await findByName(token, 'boarding-passes', { parentId: folderId, mimeType: FOLDER_MIME });
  if (bpFolder) {
    // Dedup before saving: a pass already stored locally for its date (matched
    // by fileName, which saveBoardingPass persists) is skipped, so re-running a
    // restore never duplicates a pass. Mirrors driveArchive.js downloadYear's
    // existingNames guard. Per-date existing-name sets are cached so we hit idb
    // once per date, not once per file.
    const existingByDate = new Map();
    for (const file of await listFiles(token, bpFolder)) {
      // bpFileName → `bp-${date}-${n}.${ext}`; pull the date back out of the name.
      const m = file.name.match(/^bp-(\d{4}-\d{2}-\d{2})-/);
      if (!m) continue;
      const date = m[1];
      let existingNames = existingByDate.get(date);
      if (!existingNames) {
        const existing = await getBoardingPassesForDate(date);
        existingNames = new Set(existing.map((b) => b.fileName));
        existingByDate.set(date, existingNames);
      }
      if (existingNames.has(file.name)) continue; // already restored for this date
      const bytes = await downloadBytes(token, file.id);
      const mime = file.mimeType || 'application/octet-stream';
      // saveBoardingPass takes (date, File) — reconstruct a File from the bytes.
      await saveBoardingPass(date, new File([bytes], file.name, { type: mime }));
      existingNames.add(file.name); // guard against duplicate names within this folder too
      boardingPasses++;
    }
  }
  return { ofps, boardingPasses };
}
