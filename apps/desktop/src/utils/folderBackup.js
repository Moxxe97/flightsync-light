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
import { invoke } from '@tauri-apps/api/core';
import { buildBackupPayload, BACKUP_FILENAME } from './driveBackup';
import { ofpFileName, bpFileName, extFromMime } from './driveArchive';
import {
  getAllBoardingPassDates, getBoardingPassesForDate,
  getAllOFPFlightIds, getOFPBytes,
  saveBoardingPass, saveOFP, getOFP,
} from '@flightsync/core/idb';

// The fs capability grants no static `fs:scope-*` (audit H1 — a static
// home-recursive scope would authorize the entire $HOME to any XSS/compromised
// dependency in the webview). Instead the Rust `allow_backup_folder` command
// adds exactly the user-picked folder to the fs plugin's runtime scope. Every
// fs entrypoint below (and the folder picker / restore trigger in App.jsx)
// calls this first; it's idempotent (re-allowing an already-allowed directory
// is harmless) so it's safe to call on every run, not just the first.
// Intentionally not try/caught here: if the grant itself fails, that should
// surface like any other fs error rather than being swallowed, and the
// fs call that follows would fail anyway if the folder isn't allowed.
export async function ensureFolderAccess(folder) {
  if (!folder) return;
  await invoke('allow_backup_folder', { path: folder });
}

async function ensureDirs(folder) {
  await mkdir(folder, { recursive: true });
  await mkdir(`${folder}/ofps`, { recursive: true });
  await mkdir(`${folder}/boarding-passes`, { recursive: true });
}

// `lstat` (unlike `exists`/`readFile`/`writeFile`) does NOT follow the final
// symlink, so it reliably flags both live and dangling symlinks planted at a
// path we're about to read from or write to.
//
// A genuine "path does not exist" is the ONLY lstat failure treated as safe
// (not a symlink — there's nothing there yet to follow). Any OTHER failure —
// most notably a Tauri ACL denial if `fs:allow-lstat` were ever missing or
// mis-scoped — must NOT be treated the same as "not found". Silently
// swallowing an unexpected error and reporting "not a symlink" would make the
// guard inert (this was H2's runtime defect). So we fail closed: rethrow
// anything that isn't recognizably a not-found error, and let callers decide
// how to react (abort the write vs. skip the affected file/category).
// Plain substrings, checked with .includes(); 'os error 2' is the one
// exception — as a bare substring it would also match 'os error 20' (ENOTDIR),
// 'os error 21' (EISDIR), etc., which are real (non-ENOENT) errors that must
// NOT be treated as "not found". That one entry is matched with a word
// boundary instead (see isNotFoundError below) so only the real ENOENT
// ("os error 2") matches.
const NOT_FOUND_PATTERNS = ['no such file', 'cannot find', 'not found', 'notfound'];
const NOT_FOUND_OS_ERROR_2 = /os error 2\b/;

function isNotFoundError(err) {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return NOT_FOUND_PATTERNS.some((p) => msg.includes(p)) || NOT_FOUND_OS_ERROR_2.test(msg);
}

async function lstatSymlink(path) {
  try {
    const info = await lstat(path);
    return !!info?.isSymlink;
  } catch (e) {
    if (isNotFoundError(e)) return false; // safe: nothing there (yet)
    throw e; // fail closed: unrecognized error (e.g. ACL denial) — do NOT treat as safe
  }
}

// Same check, but for call sites where the safe reaction to an unexpected
// lstat failure is "treat this file/category as unsafe and skip it" rather
// than letting the exception blow up the whole backup/restore run. A real
// not-found still resolves to `false` (safe — write/read proceeds normally).
async function isUnsafePath(path) {
  try {
    return await lstatSymlink(path);
  } catch {
    return true; // fail closed: unknown lstat error → treat as symlink/unsafe
  }
}

export async function runFolderBackup({ folder, flights, residence, settings }) {
  if (!folder) return { skipped: 'no-folder' };
  // Same guard as the Drive backup: never clobber a real backup with an
  // empty state (fresh boot, failed load).
  if ((flights?.length || 0) === 0 && (residence?.length || 0) === 0) {
    return { skipped: 'empty' };
  }
  await ensureFolderAccess(folder);
  await ensureDirs(folder);

  const backupPath = `${folder}/${BACKUP_FILENAME}`;
  if (await lstatSymlink(backupPath)) {
    throw new Error(`refusing to write backup: '${BACKUP_FILENAME}' is a symlink (possible tampering)`);
  }
  const payload = buildBackupPayload({ flights, residence, settings });
  await writeTextFile(backupPath, JSON.stringify(payload, null, 2));

  let ofps = 0;
  const ofpsDir = `${folder}/ofps`;
  if (!(await isUnsafePath(ofpsDir))) { // dir itself redirected (or lstat unusable) — skip whole category
    for (const flightId of await getAllOFPFlightIds()) {
      const path = `${ofpsDir}/${ofpFileName(flightId)}`;
      if (await isUnsafePath(path)) continue; // planted symlink (or unknown lstat error): never write through it
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
  if (!(await isUnsafePath(bpDir))) { // dir itself redirected (or lstat unusable) — skip whole category
    for (const date of await getAllBoardingPassDates()) {
      const passes = await getBoardingPassesForDate(date);
      for (let n = 0; n < passes.length; n++) {
        const bp = passes[n];
        if (!bp?.data) continue;
        const mime = bp.fileType || 'application/pdf';
        const path = `${bpDir}/${bpFileName(date, n, extFromMime(mime))}`;
        if (await isUnsafePath(path)) continue; // planted symlink (or unknown lstat error): never write through it
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
  await ensureFolderAccess(folder);
  let ofps = 0;
  const ofpsDir = `${folder}/ofps`;
  if ((await exists(ofpsDir)) && !(await isUnsafePath(ofpsDir))) {
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
  if ((await exists(bpDir)) && !(await isUnsafePath(bpDir))) {
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
