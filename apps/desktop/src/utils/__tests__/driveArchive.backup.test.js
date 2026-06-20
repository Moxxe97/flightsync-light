import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Auth + idb mocked so the module under test has a token and byte sources.
vi.mock('../cloudAuth', () => ({ ensureAccessToken: vi.fn(async () => 'tok') }));
vi.mock('@flightsync/core/idb', () => ({
  getOFPBytes: vi.fn(async () => null),
  getBoardingPassesForDate: vi.fn(async () => []),
  saveArchiveYear: vi.fn(async () => {}),
  saveOFP: vi.fn(async () => {}),
  saveBoardingPass: vi.fn(async () => {}),
}));

import { ensureFolder, uploadFile, setFileAppProperties, contentHash } from '../driveArchive';

// Query-aware Drive fetch router. Tests set folder/file existence independently:
//   globalThis.__folders = [{ id, mimeType }]   → returned for folder searches
//   globalThis.__files   = [{ id, appProperties }] → returned for file searches
let calls;
function jsonRes(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}
beforeEach(() => {
  calls = [];
  const fetchMock = vi.fn(async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', opts });
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
      const q = decodeURIComponent(url);
      const isFolderSearch = q.includes("mimeType='application/vnd.google-apps.folder'");
      return jsonRes({ files: (isFolderSearch ? globalThis.__folders : globalThis.__files) ?? [] });
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?fields=id') && opts.method === 'POST') {
      return jsonRes({ id: 'new-folder-id' });
    }
    if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
      return jsonRes({ id: 'new-file-id' });
    }
    if (url.includes('/upload/drive/v3/files/') && opts.method === 'PATCH') {
      return jsonRes({ id: 'updated-id' });
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files/') && !url.includes('?') && opts.method === 'PATCH') {
      return jsonRes({ id: 'meta-id' });
    }
    return jsonRes({}, false, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
  globalThis.__folders = [];
  globalThis.__files = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.__folders;
  delete globalThis.__files;
});

describe('ensureFolder', () => {
  it('returns an existing folder id without creating', async () => {
    globalThis.__folders = [{ id: 'existing', mimeType: 'application/vnd.google-apps.folder' }];
    const id = await ensureFolder('FlightSync Light Archives', null);
    expect(id).toBe('existing');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('creates the folder when missing (with parent)', async () => {
    globalThis.__folders = [];
    const id = await ensureFolder('2025', 'root-id');
    expect(id).toBe('new-folder-id');
    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toContain('/drive/v3/files?fields=id');
    const body = JSON.parse(post.opts.body);
    expect(body.mimeType).toBe('application/vnd.google-apps.folder');
    expect(body.parents).toEqual(['root-id']);
  });
});

describe('uploadFile', () => {
  it('multipart-creates a new file (content only, no appProperties in metadata)', async () => {
    globalThis.__files = [];
    const id = await uploadFile('year-id', 'year.json', new Blob(['{}'], { type: 'application/json' }), 'application/json');
    expect(id).toBe('new-file-id');
    const create = calls.find((c) => c.url.includes('uploadType=multipart'));
    expect(create).toBeTruthy();
  });
  it('media-PATCHes content when the file already exists', async () => {
    globalThis.__files = [{ id: 'exists' }];
    const id = await uploadFile('year-id', 'year.json', new Blob(['{}']), 'application/json');
    expect(id).toBe('exists');
    expect(calls.some((c) => c.url.includes('/upload/drive/v3/files/exists?uploadType=media') && c.method === 'PATCH')).toBe(true);
    expect(calls.some((c) => c.url === 'https://www.googleapis.com/drive/v3/files/exists' && c.method === 'PATCH')).toBe(false);
  });
});

describe('setFileAppProperties', () => {
  it('PATCHes the file metadata endpoint with appProperties', async () => {
    await setFileAppProperties('file-id', { contentHash: 'abc' });
    const patch = calls.find((c) => c.url === 'https://www.googleapis.com/drive/v3/files/file-id' && c.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(JSON.parse(patch.opts.body)).toEqual({ appProperties: { contentHash: 'abc' } });
  });
});

import { collectYearAssets, backupYearToDrive, backupAllYears } from '../driveArchive';
import * as idb from '@flightsync/core/idb';

describe('collectYearAssets', () => {
  it('reads OFP bytes + boarding-pass bytes from idb for the manifest entries', async () => {
    idb.getOFPBytes.mockImplementation(async (id) => (id === 'f1' ? new Uint8Array([1, 2]) : null));
    idb.getBoardingPassesForDate.mockImplementation(async (d) =>
      d === '2025-03-11' ? [{ data: new ArrayBuffer(3), fileType: 'application/pdf' }] : []);
    const record = { year: '2025', manifest: { ofpFlightIds: ['f1'], bpDates: ['2025-03-11'] } };
    const assets = await collectYearAssets(record);
    expect(assets.map((a) => a.name)).toEqual(['ofp-f1.pdf', 'bp-2025-03-11-0.pdf']);
    expect(assets.every((a) => a.blob instanceof Blob)).toBe(true);
  });
  it('skips OFPs/BPs with no bytes', async () => {
    idb.getOFPBytes.mockImplementation(async () => null);
    idb.getBoardingPassesForDate.mockImplementation(async () => [{ source: 'gdrive' /* no data */ }]);
    const assets = await collectYearAssets({ year: '2025', manifest: { ofpFlightIds: ['x'], bpDates: ['2025-01-01'] } });
    expect(assets).toEqual([]);
  });
});

describe('backupYearToDrive', () => {
  const record = { year: '2025', flights: [{ id: 'f1' }], residence: [], manifest: { ofpFlightIds: [], bpDates: [] }, archivedAt: '2026-01-01' };

  it('creates folders, uploads year.json (no assets), stamps the hash, returns backed-up', async () => {
    idb.getOFPBytes.mockImplementation(async () => null);
    idb.getBoardingPassesForDate.mockImplementation(async () => []);
    globalThis.__folders = []; // root + year folders missing → created
    globalThis.__files = [];   // year.json missing → uploaded; remoteYearHash null
    const out = await backupYearToDrive(record);
    expect(out.status).toBe('backed-up');
    expect(out.files).toBe(1); // year.json only (no assets)
    expect(calls.some((c) => c.url.includes('uploadType=multipart'))).toBe(true);
    expect(calls.some((c) => c.url.startsWith('https://www.googleapis.com/drive/v3/files/') && !c.url.includes('?') && c.method === 'PATCH')).toBe(true);
  });

  it('skips when the remote contentHash already matches (hash was read, nothing uploaded)', async () => {
    idb.getOFPBytes.mockImplementation(async () => null);
    idb.getBoardingPassesForDate.mockImplementation(async () => []);
    const { contentHash } = await import('../driveArchive');
    const hash = contentHash(record);
    globalThis.__folders = [{ id: 'folder', mimeType: 'application/vnd.google-apps.folder' }];
    globalThis.__files = [{ id: 'yj', appProperties: { contentHash: hash } }];
    const out = await backupYearToDrive(record);
    expect(out.status).toBe('skipped');
    expect(calls.some((c) => c.method === 'GET' && decodeURIComponent(c.url).includes("name='year.json'"))).toBe(true);
    expect(calls.some((c) => c.url.includes('uploadType=multipart') || c.url.includes('uploadType=media'))).toBe(false);
  });
});

describe('backupAllYears error isolation', () => {
  it('continues past a failing year and reports per-year status', async () => {
    idb.getOFPBytes.mockImplementation(async () => null);
    idb.getBoardingPassesForDate.mockImplementation(async () => []);
    // Custom router: the folder search for year 'BAD' returns 500 (→ that year
    // throws); every other call succeeds with empty stores.
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const dec = decodeURIComponent(url);
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
        if (dec.includes("name='BAD'")) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ files: [] }) };
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?fields=id') && opts.method === 'POST') return { ok: true, json: async () => ({ id: 'fid' }) };
      if (url.includes('/upload/drive/v3/files?uploadType=multipart')) return { ok: true, json: async () => ({ id: 'file' }) };
      if (url.startsWith('https://www.googleapis.com/drive/v3/files/') && !url.includes('?') && opts.method === 'PATCH') return { ok: true, json: async () => ({}) };
      return { ok: false, status: 500, json: async () => ({}) };
    }));
    const records = [
      { year: 'GOOD', flights: [], residence: [], manifest: { ofpFlightIds: [], bpDates: [] } },
      { year: 'BAD', flights: [], residence: [], manifest: { ofpFlightIds: [], bpDates: [] } },
    ];
    const results = await backupAllYears(records);
    expect(results.find((r) => r.year === 'GOOD').status).toBe('backed-up');
    const bad = results.find((r) => r.year === 'BAD');
    expect(bad.status).toBe('error');
    expect(bad.error).toMatch(/Drive search failed/);
  });
});

import { listDriveArchiveYears, downloadFileBytes } from '../driveArchive';

describe('listDriveArchiveYears', () => {
  it('returns [] when the root archive folder is absent', async () => {
    globalThis.__folders = []; // no folders at all
    expect(await listDriveArchiveYears()).toEqual([]);
  });
  it('lists year subfolders of the root, newest-first', async () => {
    const fetchMock = vi.fn(async (url) => {
      const dec = decodeURIComponent(url);
      if (dec.includes("name='FlightSync Light Archives'")) return { ok: true, json: async () => ({ files: [{ id: 'root', name: 'FlightSync Light Archives' }] }) };
      if (dec.includes("'root' in parents")) return { ok: true, json: async () => ({ files: [{ id: 'y24', name: '2024' }, { id: 'y25', name: '2025' }] }) };
      return { ok: true, json: async () => ({ files: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const years = await listDriveArchiveYears();
    expect(years).toEqual([{ year: '2025', folderId: 'y25' }, { year: '2024', folderId: 'y24' }]);
  });
});

describe('downloadFileBytes', () => {
  it('GETs alt=media and returns a Uint8Array', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      expect(url).toContain('/drive/v3/files/abc?alt=media');
      return { ok: true, arrayBuffer: async () => new Uint8Array([5, 6, 7]).buffer };
    }));
    const bytes = await downloadFileBytes('abc');
    expect(Array.from(bytes)).toEqual([5, 6, 7]);
  });
});

import { downloadYear } from '../driveArchive';

describe('downloadYear', () => {
  it('restores the year record, OFPs, and boarding passes into idb', async () => {
    const content = {
      flights: [{ id: 'f1', date: '2025-03-02', flightNumber: 'AC1' }],
      residence: [{ date: '2025-03-02', location: 'canada' }],
      manifest: { ofpFlightIds: ['f1'], bpDates: ['2025-03-02'] },
    };
    // Positive control for the integrity check: the hash matches the content,
    // exactly as backupYearToDrive would have written it.
    const yearJson = { year: '2025', ...content, archivedAt: '2026-01-01', contentHash: contentHash(content) };
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const dec = decodeURIComponent(url);
      if (dec.includes("name='FlightSync Light Archives'")) return { ok: true, json: async () => ({ files: [{ id: 'root', name: 'FlightSync Light Archives' }] }) };
      if (dec.includes("name='2025'")) return { ok: true, json: async () => ({ files: [{ id: 'yfolder', name: '2025' }] }) };
      if (dec.includes("'yfolder' in parents")) return { ok: true, json: async () => ({ files: [
        { id: 'jid', name: 'year.json' },
        { id: 'oid', name: 'ofp-f1.pdf' },
        { id: 'bid', name: 'bp-2025-03-02-0.pdf' },
      ] }) };
      if (url.includes('/files/jid?alt=media')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(yearJson)).buffer };
      if (url.includes('/files/oid?alt=media')) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
      if (url.includes('/files/bid?alt=media')) return { ok: true, arrayBuffer: async () => new Uint8Array([3, 4]).buffer };
      return { ok: true, json: async () => ({ files: [] }) };
    }));
    idb.saveArchiveYear.mockClear(); idb.saveOFP.mockClear(); idb.saveBoardingPass.mockClear();
    idb.getBoardingPassesForDate.mockImplementation(async () => []); // none exist yet

    const out = await downloadYear({ year: '2025', folderId: 'yfolder' });

    expect(idb.saveArchiveYear).toHaveBeenCalledWith(expect.objectContaining({ year: '2025', archivedAt: '2026-01-01' }));
    expect(idb.saveOFP).toHaveBeenCalledWith('f1', expect.objectContaining({ date: '2025-03-02', flightNumber: 'AC1', fileName: 'ofp-f1.pdf', pageCount: null }));
    expect(idb.saveBoardingPass).toHaveBeenCalledTimes(1);
    const [bpDate, bpFile] = idb.saveBoardingPass.mock.calls[0];
    expect(bpDate).toBe('2025-03-02');
    expect(bpFile.name).toBe('bp-2025-03-02-0.pdf');
    expect(out).toEqual({ year: '2025', flights: 1, ofps: 1, boardingPasses: 1 });
  });

  it('skips a boarding pass already present for the date (idempotent)', async () => {
    const bpContent = { flights: [], residence: [], manifest: { ofpFlightIds: [], bpDates: ['2025-03-02'] } };
    const yearJson = { year: '2025', ...bpContent, archivedAt: null, contentHash: contentHash(bpContent) };
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const dec = decodeURIComponent(url);
      if (dec.includes("name='FlightSync Light Archives'")) return { ok: true, json: async () => ({ files: [{ id: 'root' }] }) };
      if (dec.includes("name='2025'")) return { ok: true, json: async () => ({ files: [{ id: 'yf' }] }) };
      if (dec.includes("'yf' in parents")) return { ok: true, json: async () => ({ files: [{ id: 'jid', name: 'year.json' }, { id: 'bid', name: 'bp-2025-03-02-0.pdf' }] }) };
      if (url.includes('/files/jid?alt=media')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(yearJson)).buffer };
      if (url.includes('/files/bid?alt=media')) return { ok: true, arrayBuffer: async () => new Uint8Array([9]).buffer };
      return { ok: true, json: async () => ({ files: [] }) };
    }));
    idb.saveArchiveYear.mockClear(); idb.saveBoardingPass.mockClear();
    idb.getBoardingPassesForDate.mockImplementation(async () => [{ fileName: 'bp-2025-03-02-0.pdf', data: new ArrayBuffer(1) }]); // already there

    const out = await downloadYear({ year: '2025', folderId: 'yf' });
    expect(idb.saveBoardingPass).not.toHaveBeenCalled();
    expect(out.boardingPasses).toBe(0);
  });

  // Helper for the integrity tests: a folder containing only year.json whose
  // bytes decode to `yearJson`.
  function stubYearJsonFetch(yearJson) {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const dec = decodeURIComponent(url);
      if (dec.includes("'yf' in parents")) return { ok: true, json: async () => ({ files: [{ id: 'jid', name: 'year.json' }] }) };
      if (url.includes('/files/jid?alt=media')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(yearJson)).buffer };
      return { ok: true, json: async () => ({ files: [] }) };
    }));
  }

  it('rejects a tampered year.json (hash mismatch) before touching idb', async () => {
    // Valid shape, but the hash does not match the content → corrupted/edited on Drive.
    stubYearJsonFetch({ year: '2025', flights: [{ id: 'f1' }], residence: [], manifest: null, archivedAt: null, contentHash: '00000000' });
    idb.saveArchiveYear.mockClear(); idb.saveOFP.mockClear(); idb.saveBoardingPass.mockClear();

    await expect(downloadYear({ year: '2025', folderId: 'yf' })).rejects.toThrow(/contentHash/);
    expect(idb.saveArchiveYear).not.toHaveBeenCalled();
    expect(idb.saveOFP).not.toHaveBeenCalled();
    expect(idb.saveBoardingPass).not.toHaveBeenCalled();
  });

  it('rejects a malformed year.json (bad shape) before touching idb', async () => {
    stubYearJsonFetch({ year: '2025', flights: { evil: true }, residence: [], manifest: null, archivedAt: null, contentHash: 'deadbeef' });
    idb.saveArchiveYear.mockClear(); idb.saveOFP.mockClear(); idb.saveBoardingPass.mockClear();

    await expect(downloadYear({ year: '2025', folderId: 'yf' })).rejects.toThrow(/invalide/);
    expect(idb.saveArchiveYear).not.toHaveBeenCalled();
    expect(idb.saveOFP).not.toHaveBeenCalled();
    expect(idb.saveBoardingPass).not.toHaveBeenCalled();
  });
});

import { restoreAllFromDrive } from '../driveArchive';

describe('restoreAllFromDrive error isolation', () => {
  it('restores good years and reports a failing year without aborting', async () => {
    const c2025 = { flights: [], residence: [], manifest: { ofpFlightIds: [], bpDates: [] } };
    const yj2025 = { year: '2025', ...c2025, archivedAt: null, contentHash: contentHash(c2025) };
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const dec = decodeURIComponent(url);
      if (dec.includes("name='FlightSync Light Archives'")) return { ok: true, json: async () => ({ files: [{ id: 'root', name: 'FlightSync Light Archives' }] }) };
      if (dec.includes("'root' in parents")) return { ok: true, json: async () => ({ files: [{ id: 'g', name: '2025' }, { id: 'b', name: '2099' }] }) };
      if (dec.includes("'g' in parents")) return { ok: true, json: async () => ({ files: [{ id: 'jid', name: 'year.json' }] }) };
      if (dec.includes("'b' in parents")) return { ok: true, json: async () => ({ files: [] }) }; // 2099 has NO year.json → throws
      if (url.includes('/files/jid?alt=media')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(yj2025)).buffer };
      return { ok: true, json: async () => ({ files: [] }) };
    }));
    idb.saveArchiveYear.mockClear();
    const results = await restoreAllFromDrive();
    // newest-first: 2099 (error) then 2025 (restored)
    const good = results.find((r) => r.year === '2025');
    const bad = results.find((r) => r.year === '2099');
    expect(good.status).toBe('restored');
    expect(bad.status).toBe('error');
    expect(bad.error).toMatch(/year\.json missing/);
    // the good year was still restored despite the bad one
    expect(idb.saveArchiveYear).toHaveBeenCalledWith(expect.objectContaining({ year: '2025' }));
  });
});
