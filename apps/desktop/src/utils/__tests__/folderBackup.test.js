import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to top of file, so factories cannot reference variables
// declared in module scope. Use vi.hoisted() to share mock objects safely.
const { fsMock, idbMock, coreMock } = vi.hoisted(() => {
  const fsMock = {
    writeTextFile: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    readDir: vi.fn(async () => []),
    readFile: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), // %PDF-
    readTextFile: vi.fn(async () => '{}'),
    // Default: "not found" (ENOENT-like) — lstatSymlink() must treat this as "not a symlink".
    lstat: vi.fn(async () => { throw new Error('ENOENT: no such file or directory'); }),
  };
  const idbMock = {
    getAllBoardingPassDates: vi.fn(async () => []),
    getBoardingPassesForDate: vi.fn(async () => []),
    getAllOFPFlightIds: vi.fn(async () => new Set()),
    getOFPBytes: vi.fn(async () => null),
    saveBoardingPass: vi.fn(async () => 1),
    saveOFP: vi.fn(async () => {}),
    getOFP: vi.fn(async () => null),
  };
  // H1: runtime fs-scope grant — ensureFolderAccess() invokes this Rust
  // command. Mocked as a no-op so the fs mocks above stay the source of
  // truth for whether an operation is "allowed"; tests below assert it's
  // called (with the right path) ahead of the fs calls it gates.
  const coreMock = {
    invoke: vi.fn(async () => {}),
  };
  return { fsMock, idbMock, coreMock };
});

vi.mock('@tauri-apps/plugin-fs', () => fsMock);
vi.mock('@flightsync/core/idb', () => idbMock);
vi.mock('@tauri-apps/api/core', () => coreMock);

import {
  runFolderBackup, restoreFolderBlobs, readFolderBackupText,
  pickBackupFolder, forgetBackupFolder, isFolderNotConfirmed,
} from '../folderBackup';
import { MAX_BACKUP_BYTES, MAX_BLOB_BYTES } from '../driveBackup';

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.exists.mockResolvedValue(false);
  fsMock.lstat.mockRejectedValue(new Error('ENOENT: no such file or directory'));
  coreMock.invoke.mockResolvedValue(undefined);
});

const FLIGHTS = [{ id: 'f1', date: '2026-03-15', flightNumber: 'AC123' }];
const RES = [{ date: '2026-03-15', location: 'transit' }];

describe('runFolderBackup', () => {
  it('returns skipped:no-folder and calls neither mkdir nor writeTextFile when folder is empty', async () => {
    const r = await runFolderBackup({ folder: '', flights: FLIGHTS, residence: RES });
    expect(r).toEqual({ skipped: 'no-folder' });
    expect(fsMock.mkdir).not.toHaveBeenCalled();
    expect(fsMock.writeTextFile).not.toHaveBeenCalled();
  });

  it('refuses to write an empty state over a real backup', async () => {
    const r = await runFolderBackup({ folder: '/Users/x/Backups', flights: [], residence: [] });
    expect(r.skipped).toBe('empty');
    expect(fsMock.mkdir).not.toHaveBeenCalled();
    expect(fsMock.writeTextFile).not.toHaveBeenCalled();
  });

  it('includes the archived years in the JSON snapshot', async () => {
    const archives = [{ year: '2025', flights: [{ id: 'a1', date: '2025-12-30', flightNumber: 'AC0051' }], residence: [] }];
    await runFolderBackup({ folder: '/Users/x/Backups', flights: FLIGHTS, residence: RES, settings: {}, archives });
    const payload = JSON.parse(fsMock.writeTextFile.mock.calls[0][1]);
    expect(payload.archives).toEqual(archives);
  });

  it('still backs up in January, when only the archived years hold data', async () => {
    const archives = [{ year: '2025', flights: [{ id: 'a1', date: '2025-12-30', flightNumber: 'AC0051' }], residence: [] }];
    const r = await runFolderBackup({ folder: '/Users/x/Backups', flights: [], residence: [], settings: {}, archives });
    expect(r.skipped).toBeUndefined();
    expect(fsMock.writeTextFile).toHaveBeenCalledTimes(1);
  });

  it('writes the JSON snapshot with the Drive payload shape', async () => {
    await runFolderBackup({ folder: '/Users/x/Backups', flights: FLIGHTS, residence: RES, settings: {} });
    const [path, text] = fsMock.writeTextFile.mock.calls[0];
    expect(path).toBe('/Users/x/Backups/flightsync-light-backup.json.tmp');
    expect(fsMock.rename).toHaveBeenCalledWith('/Users/x/Backups/flightsync-light-backup.json.tmp', '/Users/x/Backups/flightsync-light-backup.json');
    const payload = JSON.parse(text);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.flights).toHaveLength(1);
    expect(payload.residence).toHaveLength(1);
  });

  // H1: the fs capability grants no static scope any more — the picked
  // folder must be re-granted via the Rust `allow_backup_folder` command on
  // every run, before any fs op (mkdir/writeTextFile/etc.) is attempted.
  it('grants runtime fs access to the folder (allow_backup_folder) before any fs write', async () => {
    await runFolderBackup({ folder: '/Users/x/Backups', flights: FLIGHTS, residence: RES, settings: {} });
    expect(coreMock.invoke).toHaveBeenCalledWith('allow_backup_folder', { path: '/Users/x/Backups' });
    const invokeOrder = coreMock.invoke.mock.invocationCallOrder[0];
    const mkdirOrder = fsMock.mkdir.mock.invocationCallOrder[0];
    const writeOrder = fsMock.writeTextFile.mock.invocationCallOrder[0];
    expect(invokeOrder).toBeLessThan(mkdirOrder);
    expect(invokeOrder).toBeLessThan(writeOrder);
  });

  it('mirrors OFPs and boarding passes write-once (skips existing files)', async () => {
    idbMock.getAllOFPFlightIds.mockResolvedValue(new Set(['f1']));
    idbMock.getOFPBytes.mockResolvedValue(new ArrayBuffer(4));
    idbMock.getAllBoardingPassDates.mockResolvedValue(['2026-03-15']);
    idbMock.getBoardingPassesForDate.mockResolvedValue([
      { id: 1, date: '2026-03-15', fileName: 'a.pdf', fileType: 'application/pdf', data: new ArrayBuffer(2) },
    ]);
    // OFP already exists; boarding pass does not
    fsMock.exists.mockImplementation(async (p) => p.endsWith('ofp-f1.pdf'));
    await runFolderBackup({ folder: '/b', flights: FLIGHTS, residence: RES, settings: {} });
    const written = fsMock.writeFile.mock.calls.map(([p]) => p);
    // BP at index 0 → bp-2026-03-15-0.pdf (0-based, matching Drive per-date index)
    expect(written).toContain('/b/boarding-passes/bp-2026-03-15-0.pdf');
    expect(written.some((p) => p.includes('ofp-f1'))).toBe(false);
  });
});

describe('restoreFolderBlobs', () => {
  it('imports folder PDFs into IndexedDB, skipping ones already present', async () => {
    fsMock.readDir.mockImplementation(async (p) => p.endsWith('ofps')
      ? [{ name: 'ofp-f1.pdf' }]
      : [{ name: 'bp-2026-03-15-0.pdf' }]);
    fsMock.exists.mockResolvedValue(true);
    idbMock.getOFP.mockResolvedValue(null);
    idbMock.getBoardingPassesForDate.mockResolvedValue([]);
    const r = await restoreFolderBlobs('/b', FLIGHTS);
    expect(idbMock.saveOFP).toHaveBeenCalledWith('f1', expect.objectContaining({ fileName: 'ofp-f1.pdf' }));
    expect(idbMock.saveBoardingPass).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ofps: 1, boardingPasses: 1, skipped: 0 });
  });

  // H1: same runtime grant, on the restore path — must happen before the
  // first exists()/readDir() call against the folder.
  it('grants runtime fs access to the folder (allow_backup_folder) before reading it', async () => {
    fsMock.readDir.mockImplementation(async () => []);
    await restoreFolderBlobs('/b', FLIGHTS);
    expect(coreMock.invoke).toHaveBeenCalledWith('allow_backup_folder', { path: '/b' });
    const invokeOrder = coreMock.invoke.mock.invocationCallOrder[0];
    const existsOrder = fsMock.exists.mock.invocationCallOrder[0];
    expect(invokeOrder).toBeLessThan(existsOrder);
  });

  it('skips OFP already in IDB and boarding pass already stored; returns zeroed counts', async () => {
    fsMock.readDir.mockImplementation(async (p) => p.endsWith('ofps')
      ? [{ name: 'ofp-f1.pdf' }]
      : [{ name: 'bp-2026-03-15-0.pdf' }]);
    fsMock.exists.mockResolvedValue(true);
    // OFP already in IDB → getOFP returns truthy → saveOFP must NOT be called
    idbMock.getOFP.mockResolvedValue({ id: 'f1', fileName: 'ofp-f1.pdf' });
    // BP already stored → getBoardingPassesForDate returns a record with matching fileName
    idbMock.getBoardingPassesForDate.mockResolvedValue([{ fileName: 'bp-2026-03-15-0.pdf' }]);
    const r = await restoreFolderBlobs('/b', FLIGHTS);
    expect(idbMock.saveOFP).not.toHaveBeenCalled();
    expect(idbMock.saveBoardingPass).not.toHaveBeenCalled();
    expect(r).toEqual({ ofps: 0, boardingPasses: 0, skipped: 0 });
  });
});

// ─── H2: writes must refuse to follow a planted symlink ───────────────────
describe('runFolderBackup symlink guards (H2)', () => {
  it('throws and refuses to write when the backup JSON target is already a symlink', async () => {
    fsMock.lstat.mockImplementation(async (p) => {
      if (p === '/b/flightsync-light-backup.json') return { isSymlink: true };
      throw new Error('ENOENT: no such file or directory');
    });
    await expect(
      runFolderBackup({ folder: '/b', flights: FLIGHTS, residence: RES, settings: {} }),
    ).rejects.toThrow(/symlink/i);
    expect(fsMock.writeTextFile).not.toHaveBeenCalled();
  });

  it('skips the whole ofps category when the ofps directory itself is a symlink', async () => {
    idbMock.getAllOFPFlightIds.mockResolvedValue(new Set(['f1']));
    idbMock.getOFPBytes.mockResolvedValue(new ArrayBuffer(4));
    fsMock.lstat.mockImplementation(async (p) => {
      if (p === '/b/ofps') return { isSymlink: true };
      throw new Error('ENOENT: no such file or directory');
    });
    const r = await runFolderBackup({ folder: '/b', flights: FLIGHTS, residence: RES, settings: {} });
    expect(fsMock.writeFile.mock.calls.some(([p]) => p.includes('/ofps/'))).toBe(false);
    expect(r.ofps).toBe(0);
  });

  it('skips an individual ofp target that is already a symlink, even when exists() reports false (dangling link)', async () => {
    idbMock.getAllOFPFlightIds.mockResolvedValue(new Set(['f1']));
    idbMock.getOFPBytes.mockResolvedValue(new ArrayBuffer(4));
    // Dangling symlink: exists() (which follows symlinks) lies and says "no file here" —
    // the write-once guard alone would NOT stop a write through it.
    fsMock.exists.mockResolvedValue(false);
    fsMock.lstat.mockImplementation(async (p) => {
      if (p === '/b/ofps/ofp-f1.pdf') return { isSymlink: true };
      throw new Error('ENOENT: no such file or directory');
    });
    const r = await runFolderBackup({ folder: '/b', flights: FLIGHTS, residence: RES, settings: {} });
    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(r.ofps).toBe(0);
  });

  // ── Fail-closed: an lstat error that is NOT a "not found" (e.g. a Tauri ACL
  // denial if fs:allow-lstat were ever missing/mis-scoped) must be treated as
  // UNSAFE, never as "not a symlink". Confirms the guard fails closed instead
  // of silently letting the write through (the exact runtime defect this fix
  // addresses).
  it('fails closed: skips (does not write) an ofp file when lstat rejects with a non-not-found error (simulated ACL denial)', async () => {
    idbMock.getAllOFPFlightIds.mockResolvedValue(new Set(['f1']));
    idbMock.getOFPBytes.mockResolvedValue(new ArrayBuffer(4));
    fsMock.lstat.mockImplementation(async (p) => {
      if (p === '/b/ofps/ofp-f1.pdf') throw new Error('fs.lstat not allowed on path');
      throw new Error('ENOENT: no such file or directory');
    });
    const r = await runFolderBackup({ folder: '/b', flights: FLIGHTS, residence: RES, settings: {} });
    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(r.ofps).toBe(0);
  });

  it('fails closed: aborts the whole backup (writeTextFile never called) when the main JSON lstat rejects with a non-not-found error', async () => {
    fsMock.lstat.mockImplementation(async (p) => {
      if (p === '/b/flightsync-light-backup.json') throw new Error('fs.lstat not allowed on path');
      throw new Error('ENOENT: no such file or directory');
    });
    await expect(
      runFolderBackup({ folder: '/b', flights: FLIGHTS, residence: RES, settings: {} }),
    ).rejects.toThrow(/fs\.lstat not allowed/);
    expect(fsMock.writeTextFile).not.toHaveBeenCalled();
  });

  it('treats a genuine not-found lstat rejection as safe and lets the write proceed', async () => {
    fsMock.lstat.mockImplementation(async (p) => {
      if (p === '/b/flightsync-light-backup.json') throw new Error('No such file or directory (os error 2)');
      throw new Error('ENOENT: no such file or directory');
    });
    await runFolderBackup({ folder: '/b', flights: FLIGHTS, residence: RES, settings: {} });
    expect(fsMock.writeTextFile).toHaveBeenCalledWith(
      '/b/flightsync-light-backup.json.tmp',
      expect.any(String),
    );
  });

  it('refuses to write through a symlink planted at the temporary file', async () => {
    fsMock.lstat.mockImplementation(async (p) => {
      if (p === '/b/flightsync-light-backup.json.tmp') return { isSymlink: true };
      throw new Error('ENOENT: no such file or directory');
    });
    await expect(
      runFolderBackup({ folder: '/b', flights: FLIGHTS, residence: RES, settings: {} }),
    ).rejects.toThrow(/symlink/i);
    expect(fsMock.writeTextFile).not.toHaveBeenCalled();
    expect(fsMock.rename).not.toHaveBeenCalled();
  });
});

// Review of 2026-11-26: the snapshot was written over the only copy in place, so a
// crash, a full disk or a sync client grabbing it mid-write left a truncated backup.
// It is now written beside it and swapped in with one rename.
describe('runFolderBackup writes the snapshot safely', () => {
  it('writes a temporary file first, then renames it over the backup', async () => {
    await runFolderBackup({ folder: '/b', flights: FLIGHTS, residence: RES, settings: {} });
    expect(fsMock.writeTextFile).toHaveBeenCalledTimes(1);
    expect(fsMock.writeTextFile.mock.calls[0][0]).toBe('/b/flightsync-light-backup.json.tmp');
    expect(fsMock.rename).toHaveBeenCalledWith('/b/flightsync-light-backup.json.tmp', '/b/flightsync-light-backup.json');
    expect(fsMock.writeTextFile.mock.invocationCallOrder[0]).toBeLessThan(fsMock.rename.mock.invocationCallOrder[0]);
  });

  it('leaves the existing backup alone when the write fails', async () => {
    fsMock.writeTextFile.mockRejectedValueOnce(new Error('No space left on device'));
    await expect(
      runFolderBackup({ folder: '/b', flights: FLIGHTS, residence: RES, settings: {} }),
    ).rejects.toThrow(/No space/);
    expect(fsMock.rename).not.toHaveBeenCalled();
  });
});

// ─── H3: restore must refuse to read through a planted symlink ────────────
describe('restoreFolderBlobs symlink guards (H3)', () => {
  it('skips a readDir entry flagged isSymlink instead of reading it (ofps)', async () => {
    fsMock.readDir.mockImplementation(async (p) => (p.endsWith('ofps')
      ? [{ name: 'ofp-f1.pdf', isSymlink: true, isFile: false, isDirectory: false }]
      : []));
    fsMock.exists.mockResolvedValue(true);
    idbMock.getOFP.mockResolvedValue(null);
    const r = await restoreFolderBlobs('/b', FLIGHTS);
    expect(fsMock.readFile).not.toHaveBeenCalled();
    expect(idbMock.saveOFP).not.toHaveBeenCalled();
    expect(r.ofps).toBe(0);
  });

  it('skips a readDir entry flagged isSymlink instead of reading it (boarding passes)', async () => {
    fsMock.readDir.mockImplementation(async (p) => (p.endsWith('boarding-passes')
      ? [{ name: 'bp-2026-03-15-0.pdf', isSymlink: true, isFile: false, isDirectory: false }]
      : []));
    fsMock.exists.mockResolvedValue(true);
    idbMock.getBoardingPassesForDate.mockResolvedValue([]);
    const r = await restoreFolderBlobs('/b', FLIGHTS);
    expect(fsMock.readFile).not.toHaveBeenCalled();
    expect(idbMock.saveBoardingPass).not.toHaveBeenCalled();
    expect(r.boardingPasses).toBe(0);
  });

  it('skips the whole ofps category (never calls readDir on it) when the subdir itself is a symlink', async () => {
    fsMock.exists.mockResolvedValue(true);
    fsMock.lstat.mockImplementation(async (p) => {
      if (p === '/b/ofps') return { isSymlink: true };
      throw new Error('ENOENT: no such file or directory');
    });
    const r = await restoreFolderBlobs('/b', FLIGHTS);
    expect(fsMock.readDir.mock.calls.some(([p]) => p === '/b/ofps')).toBe(false);
    expect(r.ofps).toBe(0);
  });
});

// Review of 2026-11-26: the folder restore saved whatever bytes sat under an
// expected name, of any size. It now runs the same checks as the Drive restore.
describe('restoreFolderBlobs checks what it restores', () => {
  const both = async (p) => (p.endsWith('ofps') ? [{ name: 'ofp-f1.pdf' }] : [{ name: 'bp-2026-03-15-0.pdf' }]);
  beforeEach(() => {
    fsMock.exists.mockResolvedValue(true);
    fsMock.readDir.mockImplementation(both);
    idbMock.getOFP.mockResolvedValue(null);
    idbMock.getBoardingPassesForDate.mockResolvedValue([]);
  });

  it('skips files whose bytes are not a PDF / image, and counts them', async () => {
    fsMock.readFile.mockResolvedValue(new TextEncoder().encode('<html>'));
    const r = await restoreFolderBlobs('/b', FLIGHTS);
    expect(idbMock.saveOFP).not.toHaveBeenCalled();
    expect(idbMock.saveBoardingPass).not.toHaveBeenCalled();
    expect(r).toEqual({ ofps: 0, boardingPasses: 0, skipped: 2 });
  });

  it('skips a file over the size limit without reading it', async () => {
    fsMock.lstat.mockImplementation(async (p) => {
      if (p.endsWith('.pdf')) return { isSymlink: false, size: MAX_BLOB_BYTES + 1 };
      throw new Error('ENOENT: no such file or directory');
    });
    const r = await restoreFolderBlobs('/b', FLIGHTS);
    expect(fsMock.readFile).not.toHaveBeenCalled();
    expect(r.skipped).toBe(2);
  });

  it('stores a boarding pass with the type its bytes show, not the one its name claims', async () => {
    fsMock.readDir.mockImplementation(async (p) => (p.endsWith('ofps') ? [] : [{ name: 'bp-2026-03-15-0.pdf' }]));
    fsMock.readFile.mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]));
    await restoreFolderBlobs('/b', FLIGHTS);
    expect(idbMock.saveBoardingPass.mock.calls[0][1].type).toBe('image/png');
  });
});

describe('readFolderBackupText', () => {
  it('reads the backup file after granting access to the folder', async () => {
    fsMock.readTextFile.mockResolvedValue('{"schemaVersion":1}');
    expect(await readFolderBackupText('/b')).toBe('{"schemaVersion":1}');
    expect(coreMock.invoke).toHaveBeenCalledWith('allow_backup_folder', { path: '/b' });
    expect(fsMock.readTextFile).toHaveBeenCalledWith('/b/flightsync-light-backup.json');
  });
  it('refuses to read through a symlink planted at the backup file', async () => {
    fsMock.lstat.mockResolvedValue({ isSymlink: true, size: 10 });
    await expect(readFolderBackupText('/b')).rejects.toThrow(/symlink/);
    expect(fsMock.readTextFile).not.toHaveBeenCalled();
  });
  it('refuses a backup file over the size limit', async () => {
    fsMock.lstat.mockResolvedValue({ isSymlink: false, size: MAX_BACKUP_BYTES + 1 });
    await expect(readFolderBackupText('/b')).rejects.toThrow(/too large/);
    expect(fsMock.readTextFile).not.toHaveBeenCalled();
  });
});

// Review of 2026-11-26: allow_backup_folder granted file access to any path the
// page sent. The folder is now picked in Rust, which records it and re-grants
// only that folder; the page just asks.
describe('backup folder choice lives on the Rust side', () => {
  it('pickBackupFolder asks Rust to show the picker and returns the folder', async () => {
    coreMock.invoke.mockResolvedValueOnce('/Users/x/Backups');
    expect(await pickBackupFolder()).toBe('/Users/x/Backups');
    expect(coreMock.invoke).toHaveBeenCalledWith('pick_backup_folder');
  });
  it('pickBackupFolder returns null when the pilot cancels', async () => {
    coreMock.invoke.mockResolvedValueOnce(null);
    expect(await pickBackupFolder()).toBeNull();
  });
  it('forgetBackupFolder tells Rust to forget it, and never throws', async () => {
    coreMock.invoke.mockRejectedValueOnce(new Error('not in Tauri'));
    await expect(forgetBackupFolder()).resolves.toBeUndefined();
    expect(coreMock.invoke).toHaveBeenCalledWith('forget_backup_folder');
  });
  it('recognises the "choose it again" refusal', () => {
    expect(isFolderNotConfirmed(new Error('BACKUP_FOLDER_NOT_CONFIRMED: choose the backup folder again'))).toBe(true);
    expect(isFolderNotConfirmed('BACKUP_FOLDER_NOT_CONFIRMED')).toBe(true);
    expect(isFolderNotConfirmed(new Error('Permission denied'))).toBe(false);
  });
});
