// ─── Local-folder backup destination ─────────────────────────────
// Same payload and layout as the Drive backup so a pilot can switch
// destinations (or restore from either) without conversion:
//   <folder>/flightsync-light-backup.json     (overwritten in place)
//   <folder>/ofps/ofp-{flightId}.pdf          (write-once)
//   <folder>/boarding-passes/bp-{date}-{n}.*  (write-once, 0-based per-date index)
// Pointing the folder inside iCloud Drive/Dropbox gives off-device backup
// with no account and no OAuth.
import {
  writeTextFile, writeFile, mkdir, exists, readDir, readFile, lstat,
} from '@tauri-apps/plugin-fs';
import { buildBackupPayload, BACKUP_FILENAME } from './driveBackup';
import { ofpFileName, bpFileName, extFromMime } from './driveArchive';
import {
  getAllBoardingPassDates, getBoardingPassesForDate,
  getAllOFPFlightIds, getOFPBytes,
  saveBoardingPass, saveOFP, getOFP,
} from '@flightsync/core/idb';

async function ensureDirs(folder) {
  await mkdir(folder, { recursive: true });
  await mkdir(`${folder}/ofps`, { recursive: true });
  await mkdir(`${folder}/boarding-passes`, { recursive: true });
}

// `lstat` (unlike `exists`/`readFile`/`writeFile`) does NOT follow the final
// symlink, so it reliably flags both live and dangling symlinks planted at a
// path we're about to read from or write to. Treat "not found" as false —
// a missing path is not (yet) a symlink.
async function lstatSymlink(path) {
  try {
    const info = await lstat(path);
    return !!info?.isSymlink;
  } catch {
    return false;
  }
}

export async function runFolderBackup({ folder, flights, residence, settings }) {
  if (!folder) return { skipped: 'no-folder' };
  // Same guard as the Drive backup: never clobber a real backup with an
  // empty state (fresh boot, failed load).
  if ((flights?.length || 0) === 0 && (residence?.length || 0) === 0) {
    return { skipped: 'empty' };
  }
  await ensureDirs(folder);

  const backupPath = `${folder}/${BACKUP_FILENAME}`;
  if (await lstatSymlink(backupPath)) {
    throw new Error(`refusing to write backup: '${BACKUP_FILENAME}' is a symlink (possible tampering)`);
  }
  const payload = buildBackupPayload({ flights, residence, settings });
  await writeTextFile(backupPath, JSON.stringify(payload, null, 2));

  let ofps = 0;
  const ofpsDir = `${folder}/ofps`;
  if (!(await lstatSymlink(ofpsDir))) { // dir itself redirected — skip whole category
    for (const flightId of await getAllOFPFlightIds()) {
      const path = `${ofpsDir}/${ofpFileName(flightId)}`;
      if (await lstatSymlink(path)) continue; // planted symlink: never write through it
      if (await exists(path)) continue; // immutable: written once
      const bytes = await getOFPBytes(flightId);
      if (!bytes) continue;
      await writeFile(path, new Uint8Array(bytes));
      ofps++;
    }
  }

  let boardingPasses = 0;
  const bpDir = `${folder}/boarding-passes`;
  // Per-date iteration keeps the index `n` in bpFileName STABLE across runs —
  // same semantics as driveBackup.js backupBlobs (0-based per-date counter).
  if (!(await lstatSymlink(bpDir))) { // dir itself redirected — skip whole category
    for (const date of await getAllBoardingPassDates()) {
      const passes = await getBoardingPassesForDate(date);
      for (let n = 0; n < passes.length; n++) {
        const bp = passes[n];
        if (!bp?.data) continue;
        const mime = bp.fileType || 'application/pdf';
        const path = `${bpDir}/${bpFileName(date, n, extFromMime(mime))}`;
        if (await lstatSymlink(path)) continue; // planted symlink: never write through it
        if (await exists(path)) continue;
        await writeFile(path, new Uint8Array(bp.data));
        boardingPasses++;
      }
    }
  }
  return { ofps, boardingPasses };
}

// Re-import the folder's PDF mirrors into IndexedDB after a JSON restore.
// flights: the restored flight rows (id/date/flightNumber feed saveOFP
// metadata). Skips blobs already present in IDB.
export async function restoreFolderBlobs(folder, flights) {
  let ofps = 0;
  const ofpsDir = `${folder}/ofps`;
  if ((await exists(ofpsDir)) && !(await lstatSymlink(ofpsDir))) {
    const byId = new Map((flights || []).map((f) => [String(f.id), f]));
    for (const e of await readDir(ofpsDir)) {
      if (e.isSymlink) continue; // planted symlink entry — never read through it
      const m = /^ofp-(.+)\.pdf$/i.exec(e.name || '');
      if (!m) continue;
      const flight = byId.get(m[1]);
      if (!flight) continue;            // orphan mirror — flight row is gone
      if (await getOFP(m[1])) continue; // already in IDB
      const data = await readFile(`${ofpsDir}/${e.name}`);
      await saveOFP(m[1], {
        date: flight.date, flightNumber: flight.flightNumber,
        fileName: e.name, data: new Uint8Array(data), pageCount: null,
      });
      ofps++;
    }
  }

  let boardingPasses = 0;
  const bpDir = `${folder}/boarding-passes`;
  if ((await exists(bpDir)) && !(await lstatSymlink(bpDir))) {
    // Dedup guard: match by fileName within the date, same as driveBackup.restoreBlobs.
    const existingByDate = new Map();
    for (const e of await readDir(bpDir)) {
      if (e.isSymlink) continue; // planted symlink entry — never read through it
      const m = /^bp-(\d{4}-\d{2}-\d{2})-\d+\.(\w+)$/i.exec(e.name || '');
      if (!m) continue;
      const [, date, ext] = m;
      let existingNames = existingByDate.get(date);
      if (!existingNames) {
        const existing = await getBoardingPassesForDate(date);
        existingNames = new Set(existing.map((b) => b.fileName));
        existingByDate.set(date, existingNames);
      }
      if (existingNames.has(e.name)) continue;
      const data = await readFile(`${bpDir}/${e.name}`);
      const type = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      await saveBoardingPass(date, new File([data], e.name, { type }));
      existingNames.add(e.name);
      boardingPasses++;
    }
  }
  return { ofps, boardingPasses };
}
