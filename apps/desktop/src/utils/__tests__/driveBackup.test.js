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

import {
  buildBackupPayload, runBackup, restoreBlobs, downloadBackup, persistRestoreData, sniffMagic,
  BACKUP_FILENAME, BACKUP_FOLDER, MAX_BACKUP_BYTES, MAX_BLOB_BYTES,
} from '../driveBackup';

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
      .rejects.toThrow(/Not signed in/);
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
      // alt=media byte download for the missing file only. Real %PDF magic bytes
      // so this fixture passes the M8 content-validation gate — this test is
      // about dedup, not validation (that's covered separately).
      if (u.includes('alt=media')) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]).buffer };
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

describe('sniffMagic (M8)', () => {
  it('recognizes a PDF magic number', () => {
    expect(sniffMagic(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe('pdf');
  });
  it('recognizes a JPEG magic number', () => {
    expect(sniffMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
  });
  it('recognizes a PNG magic number', () => {
    expect(sniffMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('png');
  });
  it('returns null for unrecognized bytes', () => {
    expect(sniffMagic(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
  it('returns null for bytes shorter than any known magic number', () => {
    expect(sniffMagic(new Uint8Array([0x25, 0x50]))).toBeNull();
  });
});

describe('restoreBlobs content validation (M8)', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });

  it('saves a valid %PDF OFP but skips a same-named file with a bad magic number, counting it as skipped', async () => {
    const idb = await import('@flightsync/core/idb');
    idb.saveOFP.mockClear();
    const flights = [
      { id: 'f1', date: '2025-01-01', flightNumber: 'AC100' },
      { id: 'f2', date: '2025-01-02', flightNumber: 'AC200' },
    ];

    globalThis.fetch.mockImplementation(async (url) => {
      const u = String(url);
      const dec = decodeURIComponent(u);
      if (dec.includes(`name='${BACKUP_FOLDER}'`)) return okJson({ files: [{ id: 'ROOT' }] });
      if (dec.includes("name='ofps'")) return okJson({ files: [{ id: 'OFPF' }] });
      if (dec.includes("name='boarding-passes'")) return okJson({ files: [] });
      if (dec.includes("'OFPF' in parents")) {
        return okJson({ files: [
          { id: 'GOODPDF', name: 'ofp-f1.pdf' },
          { id: 'BADMAGIC', name: 'ofp-f2.pdf' },
        ] });
      }
      if (u.includes('alt=media')) {
        if (u.includes('GOODPDF')) {
          return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2]).buffer };
        }
        if (u.includes('BADMAGIC')) {
          return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0x00, 0x01, 0x02]).buffer };
        }
      }
      return okJson({ files: [] });
    });

    const out = await restoreBlobs(flights);

    expect(idb.saveOFP).toHaveBeenCalledTimes(1);
    expect(idb.saveOFP.mock.calls[0][0]).toBe('f1');
    expect(out.ofps).toBe(1);
    expect(out.skipped).toBe(1);
  });

  it('skips an oversized OFP blob even when it starts with a valid PDF magic number', async () => {
    const idb = await import('@flightsync/core/idb');
    idb.saveOFP.mockClear();
    const flights = [{ id: 'f1', date: '2025-01-01', flightNumber: 'AC100' }];
    const oversized = new Uint8Array(MAX_BLOB_BYTES + 1);
    oversized.set([0x25, 0x50, 0x44, 0x46]);

    globalThis.fetch.mockImplementation(async (url) => {
      const u = String(url);
      const dec = decodeURIComponent(u);
      if (dec.includes(`name='${BACKUP_FOLDER}'`)) return okJson({ files: [{ id: 'ROOT' }] });
      if (dec.includes("name='ofps'")) return okJson({ files: [{ id: 'OFPF' }] });
      if (dec.includes("name='boarding-passes'")) return okJson({ files: [] });
      if (dec.includes("'OFPF' in parents")) return okJson({ files: [{ id: 'HUGE', name: 'ofp-f1.pdf' }] });
      if (u.includes('alt=media')) return { ok: true, status: 200, arrayBuffer: async () => oversized.buffer };
      return okJson({ files: [] });
    });

    const out = await restoreBlobs(flights);

    expect(idb.saveOFP).not.toHaveBeenCalled();
    expect(out.ofps).toBe(0);
    expect(out.skipped).toBe(1);
  });

  it('accepts a JPEG-magic boarding pass but skips a same-folder file with an invalid magic number', async () => {
    const idb = await import('@flightsync/core/idb');
    idb.saveBoardingPass.mockClear();
    idb.getBoardingPassesForDate.mockImplementation(async () => []);
    const date = '2025-03-11';

    globalThis.fetch.mockImplementation(async (url) => {
      const u = String(url);
      const dec = decodeURIComponent(u);
      if (dec.includes(`name='${BACKUP_FOLDER}'`)) return okJson({ files: [{ id: 'ROOT' }] });
      if (dec.includes("name='ofps'")) return okJson({ files: [] });
      if (dec.includes("name='boarding-passes'")) return okJson({ files: [{ id: 'BPF' }] });
      if (dec.includes("'BPF' in parents")) {
        return okJson({ files: [
          { id: 'GOODJPG', name: `bp-${date}-0.jpg`, mimeType: 'image/jpeg' },
          { id: 'BADBP', name: `bp-${date}-1.jpg`, mimeType: 'image/jpeg' },
        ] });
      }
      if (u.includes('alt=media')) {
        if (u.includes('GOODJPG')) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer };
        if (u.includes('BADBP')) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0x00, 0x01, 0x02]).buffer };
      }
      return okJson({ files: [] });
    });

    const out = await restoreBlobs([]);

    expect(idb.saveBoardingPass).toHaveBeenCalledTimes(1);
    expect(idb.saveBoardingPass.mock.calls[0][0]).toBe(date);
    expect(idb.saveBoardingPass.mock.calls[0][1].name).toBe(`bp-${date}-0.jpg`);
    expect(out.boardingPasses).toBe(1);
    expect(out.skipped).toBe(1);
  });
});

describe('downloadBackup size cap (M6b)', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });

  it('throws before reading the body when Content-Length exceeds the cap', async () => {
    const textSpy = vi.fn(async () => '{}');
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (k) => (k === 'content-length' ? String(MAX_BACKUP_BYTES + 1) : null) },
      text: textSpy,
    });
    await expect(downloadBackup('FILE')).rejects.toThrow(/too large/);
    expect(textSpy).not.toHaveBeenCalled();
  });

  it('resolves normally for a small backup that declares a Content-Length', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (k) => (k === 'content-length' ? '11' : null) },
      text: async () => '{"ok":true}',
    });
    await expect(downloadBackup('FILE')).resolves.toBe('{"ok":true}');
  });

  it('falls back to the resolved text length and rejects an oversized body with no Content-Length', async () => {
    const bigText = 'x'.repeat(MAX_BACKUP_BYTES + 1);
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => bigText,
    });
    await expect(downloadBackup('FILE')).rejects.toThrow(/too large/);
  });
});

describe('persistRestoreData ordering (M6a)', () => {
  const keys = { FLIGHTS: 'ac-flights-data', RESIDENCE: 'ac-residence-data', SETTINGS: 'ac-sync-settings' };

  it('persists flights, then residence, then settings, in that order', async () => {
    const calls = [];
    const storage = { set: vi.fn(async (k) => { calls.push(k); }) };
    await persistRestoreData(storage, keys, { flights: [{ id: 'f1' }], residence: [{ date: 'd1' }], settings: { a: 1 } });
    expect(calls).toEqual([keys.FLIGHTS, keys.RESIDENCE, keys.SETTINGS]);
  });

  it('skips the settings write when settings is null', async () => {
    const storage = { set: vi.fn(async () => {}) };
    await persistRestoreData(storage, keys, { flights: [], residence: [], settings: null });
    expect(storage.set).toHaveBeenCalledTimes(2);
  });

  it('propagates a mid-sequence storage failure (e.g. QuotaExceededError) without finishing remaining writes', async () => {
    const calls = [];
    const storage = {
      set: vi.fn(async (k) => {
        calls.push(k);
        if (k === keys.RESIDENCE) throw new Error('QuotaExceededError');
      }),
    };
    // This ordering contract is what App.jsx's restoreFromDrive relies on: it
    // only calls setFlights/setResidence/setSettings AFTER this call resolves,
    // so a throw here (like this simulated quota failure) means React state
    // is never mutated ahead of what actually made it to disk.
    await expect(persistRestoreData(storage, keys, { flights: [], residence: [], settings: { a: 1 } }))
      .rejects.toThrow(/QuotaExceededError/);
    expect(calls).toEqual([keys.FLIGHTS, keys.RESIDENCE]); // SETTINGS never reached
  });
});
