import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../cloudAuth', () => ({
  ensureAccessToken: vi.fn(async () => 'TOK'),
}));
vi.mock('@flightsync/core/idb', () => ({
  getAllOFPFlightIds: vi.fn(async () => []),
  getOFPBytes: vi.fn(async () => null),
  getAllBoardingPassDates: vi.fn(async () => []),
  getBoardingPassesForDate: vi.fn(async () => []),
  saveOFP: vi.fn(async () => {}),
  saveBoardingPass: vi.fn(async () => {}),
}));

import { buildBackupPayload, runBackup, restoreBlobs, BACKUP_FILENAME, BACKUP_FOLDER } from '../driveBackup';

const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });

describe('buildBackupPayload', () => {
  it('wraps data with schemaVersion and exportedAt', () => {
    const p = buildBackupPayload({ flights: [{ id: 'f1' }], residence: [], settings: { a: 1 } });
    expect(p.schemaVersion).toBe(1);
    expect(typeof p.exportedAt).toBe('string');
    expect(p.flights).toEqual([{ id: 'f1' }]);
    expect(p.settings).toEqual({ a: 1 });
  });

  it('never serializes machine-specific settings (backupFolder) into the payload', () => {
    const p = buildBackupPayload({
      flights: [], residence: [],
      settings: { backupReminder: 7, backupFolder: '/Users/x/iCloud/FlightSync' },
    });
    expect(p.settings.backupFolder).toBeUndefined();
    expect(p.settings.backupReminder).toBe(7);
  });
});

describe('runBackup', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });

  it('creates folder + new backup file when none exist', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(okJson({ files: [] }))                  // folder search
      .mockResolvedValueOnce(okJson({ id: 'FOLDER' }))               // folder create
      .mockResolvedValueOnce(okJson({ files: [] }))                  // backup-file search
      .mockResolvedValueOnce(okJson({ id: 'FILE' }));                // multipart create
    await runBackup({ flights: [], residence: [], settings: {} });
    const calls = globalThis.fetch.mock.calls.map(([url]) => String(url));
    expect(calls[0]).toContain(encodeURIComponent(BACKUP_FOLDER));
    expect(calls[3]).toContain('uploadType=multipart');
  });

  it('updates in place when the backup file exists', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(okJson({ files: [{ id: 'FOLDER' }] }))
      .mockResolvedValueOnce(okJson({ files: [{ id: 'FILE' }] }))
      .mockResolvedValueOnce(okJson({ id: 'FILE' }));                // PATCH media
    await runBackup({ flights: [], residence: [], settings: {} });
    const patch = globalThis.fetch.mock.calls[2];
    expect(String(patch[0])).toContain('/FILE?uploadType=media');
    expect(patch[1].method).toBe('PATCH');
  });

  it('throws when signed out (no token)', async () => {
    const { ensureAccessToken } = await import('../cloudAuth');
    ensureAccessToken.mockResolvedValueOnce(null);
    await expect(runBackup({ flights: [], residence: [], settings: {} }))
      .rejects.toThrow(/Non authentifié/);
  });

  it('names things for Light only', () => {
    expect(BACKUP_FOLDER).toBe('FlightSync Light');
    expect(BACKUP_FILENAME).toBe('flightsync-light-backup.json');
  });
});

describe('runBackup blob mirror (includeBlobs)', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });

  it('uploads only OFPs/BPs not already named in the subfolders', async () => {
    const idb = await import('@flightsync/core/idb');
    idb.getAllOFPFlightIds.mockResolvedValueOnce(['f1', 'f2']);
    idb.getOFPBytes.mockImplementation(async () => new Uint8Array([1]));
    idb.getAllBoardingPassDates.mockResolvedValueOnce(['2025-03-11', '2025-03-12']);
    idb.getBoardingPassesForDate.mockImplementation(async (d) =>
      d === '2025-03-11'
        ? [{ date: '2025-03-11', fileType: 'application/pdf', data: new ArrayBuffer(2) }]
        : [{ date: '2025-03-12', fileType: 'image/png', data: new ArrayBuffer(2) }]);

    globalThis.fetch
      .mockResolvedValueOnce(okJson({ files: [{ id: 'FOLDER' }] }))   // root folder search
      .mockResolvedValueOnce(okJson({ files: [{ id: 'FILE' }] }))     // backup-file search
      .mockResolvedValueOnce(okJson({ id: 'FILE' }))                  // PATCH media
      .mockResolvedValueOnce(okJson({ files: [{ id: 'OFPF' }] }))     // ofps folder search
      .mockResolvedValueOnce(okJson({ files: [{ id: 'BPF' }] }))      // boarding-passes folder search
      // listFiles(ofps): f1 already present (ofp-f1.pdf), f2 missing
      .mockResolvedValueOnce(okJson({ files: [{ id: 'X', name: 'ofp-f1.pdf' }] }))
      // listFiles(boarding-passes): none present
      .mockResolvedValueOnce(okJson({ files: [] }))
      // uploads: ofp-f2.pdf, bp-2025-03-11-0.pdf, bp-2025-03-12-0.png
      .mockResolvedValueOnce(okJson({ id: 'U1' }))
      .mockResolvedValueOnce(okJson({ id: 'U2' }))
      .mockResolvedValueOnce(okJson({ id: 'U3' }));

    await runBackup({ flights: [], residence: [], settings: {}, includeBlobs: true });

    const multipart = globalThis.fetch.mock.calls.filter(([url]) => String(url).includes('uploadType=multipart'));
    // 3 uploads: ofp-f2 (f1 skipped) + 2 boarding passes
    expect(multipart.length).toBe(3);
  });

  it('names boarding passes with PER-DATE counters, not a global index', async () => {
    const idb = await import('@flightsync/core/idb');
    idb.getAllOFPFlightIds.mockResolvedValueOnce([]);
    // Two passes on dateA, one on dateB. A global index would name them
    // bp-A-0, bp-A-1, bp-B-2; per-date counters give bp-A-0, bp-A-1, bp-B-0.
    const dateA = '2025-03-11';
    const dateB = '2025-03-20';
    idb.getAllBoardingPassDates.mockResolvedValueOnce([dateA, dateB]);
    idb.getBoardingPassesForDate.mockImplementation(async (d) =>
      d === dateA
        ? [
            { date: dateA, fileType: 'application/pdf', data: new ArrayBuffer(1) },
            { date: dateA, fileType: 'application/pdf', data: new ArrayBuffer(1) },
          ]
        : [{ date: dateB, fileType: 'application/pdf', data: new ArrayBuffer(1) }]);

    globalThis.fetch
      .mockResolvedValueOnce(okJson({ files: [{ id: 'FOLDER' }] }))   // root folder search
      .mockResolvedValueOnce(okJson({ files: [{ id: 'FILE' }] }))     // backup-file search
      .mockResolvedValueOnce(okJson({ id: 'FILE' }))                  // PATCH media
      .mockResolvedValueOnce(okJson({ files: [{ id: 'OFPF' }] }))     // ofps folder search
      .mockResolvedValueOnce(okJson({ files: [{ id: 'BPF' }] }))      // boarding-passes folder search
      .mockResolvedValueOnce(okJson({ files: [] }))                   // listFiles(ofps): none
      .mockResolvedValueOnce(okJson({ files: [] }))                   // listFiles(boarding-passes): none
      .mockResolvedValueOnce(okJson({ id: 'U1' }))
      .mockResolvedValueOnce(okJson({ id: 'U2' }))
      .mockResolvedValueOnce(okJson({ id: 'U3' }));

    await runBackup({ flights: [], residence: [], settings: {}, includeBlobs: true });

    // Pull the uploaded names out of the multipart metadata parts.
    const uploadedNames = globalThis.fetch.mock.calls
      .filter(([url]) => String(url).includes('uploadType=multipart'))
      .map(([, init]) => {
        const meta = init.body.get('metadata'); // FormData → metadata Blob
        return meta;
      });
    // Names aren't trivially readable off the Blob synchronously, so assert via
    // the FormData 'file' Blob count + decode metadata names.
    const names = await Promise.all(uploadedNames.map(async (b) => JSON.parse(await b.text()).name));
    expect(names).toEqual([`bp-${dateA}-0.pdf`, `bp-${dateA}-1.pdf`, `bp-${dateB}-0.pdf`]);
  });
});

describe('restoreBlobs dedup', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });

  it('skips a boarding pass already present locally for its date, but saves a missing one', async () => {
    const idb = await import('@flightsync/core/idb');
    idb.saveBoardingPass.mockClear();
    const date = '2025-03-11';
    // One pass already restored locally (bp-...-0.pdf); the -1 is genuinely missing.
    idb.getBoardingPassesForDate.mockImplementation(async (d) =>
      d === date ? [{ fileName: `bp-${date}-0.pdf`, data: new ArrayBuffer(1) }] : []);

    globalThis.fetch.mockImplementation(async (url) => {
      const u = String(url);
      const dec = decodeURIComponent(u);
      if (dec.includes(`name='${BACKUP_FOLDER}'`)) return okJson({ files: [{ id: 'ROOT' }] });
      if (dec.includes("name='ofps'")) return okJson({ files: [] });        // no ofps folder
      if (dec.includes("name='boarding-passes'")) return okJson({ files: [{ id: 'BPF' }] });
      // listFiles(boarding-passes): the already-present -0 and the missing -1.
      if (u.includes("'BPF'") || dec.includes("'BPF' in parents")) {
        return okJson({ files: [
          { id: 'BID0', name: `bp-${date}-0.pdf`, mimeType: 'application/pdf' },
          { id: 'BID1', name: `bp-${date}-1.pdf`, mimeType: 'application/pdf' },
        ] });
      }
      // alt=media byte download for the missing file only.
      if (u.includes('alt=media')) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([7]).buffer };
      return okJson({ files: [] });
    });

    const out = await restoreBlobs([]);

    // Only the missing -1 is saved; -0 (already local) is skipped.
    expect(idb.saveBoardingPass).toHaveBeenCalledTimes(1);
    expect(idb.saveBoardingPass.mock.calls[0][0]).toBe(date);
    expect(idb.saveBoardingPass.mock.calls[0][1].name).toBe(`bp-${date}-1.pdf`);
    expect(out.boardingPasses).toBe(1);

    // No alt=media fetch for the already-present file's fileId (BID0).
    const mediaUrls = globalThis.fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('alt=media'));
    expect(mediaUrls.some((u) => u.includes('BID0'))).toBe(false);
    expect(mediaUrls.some((u) => u.includes('BID1'))).toBe(true);
  });
});
