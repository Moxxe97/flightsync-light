import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to top of file, so factories cannot reference variables
// declared in module scope. Use vi.hoisted() to share mock objects safely.
const { fsMock, idbMock } = vi.hoisted(() => {
  const fsMock = {
    writeTextFile: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    readDir: vi.fn(async () => []),
    readFile: vi.fn(async () => new Uint8Array([1])),
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
  return { fsMock, idbMock };
});

vi.mock('@tauri-apps/plugin-fs', () => fsMock);
vi.mock('@flightsync/core/idb', () => idbMock);

import { runFolderBackup, restoreFolderBlobs } from '../folderBackup';

beforeEach(() => { vi.clearAllMocks(); fsMock.exists.mockResolvedValue(false); });

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

  it('writes the JSON snapshot with the Drive payload shape', async () => {
    await runFolderBackup({ folder: '/Users/x/Backups', flights: FLIGHTS, residence: RES, settings: {} });
    const [path, text] = fsMock.writeTextFile.mock.calls[0];
    expect(path).toBe('/Users/x/Backups/flightsync-light-backup.json');
    const payload = JSON.parse(text);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.flights).toHaveLength(1);
    expect(payload.residence).toHaveLength(1);
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
    expect(r).toEqual({ ofps: 1, boardingPasses: 1 });
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
    expect(r).toEqual({ ofps: 0, boardingPasses: 0 });
  });
});
