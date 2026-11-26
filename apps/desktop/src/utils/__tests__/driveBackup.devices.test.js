// Every device used to PATCH the same flightsync-light-backup.json, so the last
// device to change anything replaced the others' data on Drive. Each device now
// writes only its own file, labelled (appProperties) so a restore can list the
// backups without downloading them. Archived years travel in the payload.
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

import { buildBackupPayload, runBackup, listBackups, backupFileName } from '../driveBackup';

const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });
const ARCHIVES = [{ year: '2025', flights: [{ id: 'a' }, { id: 'b' }], residence: [], manifest: { schema: 1 }, archivedAt: 'z' }];

describe('buildBackupPayload — archived years', () => {
  it('carries each archived year as year + flights + residence only', () => {
    const p = buildBackupPayload({ flights: [], residence: [], settings: {}, archives: ARCHIVES });
    expect(p.archives).toEqual([{ year: '2025', flights: [{ id: 'a' }, { id: 'b' }], residence: [] }]);
  });

  it('defaults to no archived years', () => {
    expect(buildBackupPayload({ flights: [], residence: [], settings: {} }).archives).toEqual([]);
  });
});

describe('one backup file per device', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });

  it('names the file after the device', () => {
    expect(backupFileName('DEV-AB12CD34')).toBe('flightsync-light-backup-DEV-AB12CD34.json');
  });

  it("creates this device's own file, labelled with device, platform and counts", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(okJson({ files: [{ id: 'FOLDER' }] })) // folder search
      .mockResolvedValueOnce(okJson({ files: [] }))                 // own-file search
      .mockResolvedValueOnce(okJson({ id: 'FILE' }));               // multipart create
    await runBackup({
      flights: [{ id: 'f' }], residence: [{ date: '2026-01-02' }], settings: {}, archives: ARCHIVES,
      device: { id: 'DEV-AB12CD34', platform: 'android' },
    });
    expect(decodeURIComponent(String(globalThis.fetch.mock.calls[1][0])))
      .toContain("name='flightsync-light-backup-DEV-AB12CD34.json'");
    const [url, init] = globalThis.fetch.mock.calls[2];
    expect(String(url)).toContain('uploadType=multipart');
    expect(init.method).toBe('POST');
    const meta = JSON.parse(await init.body.get('metadata').text());
    expect(meta.name).toBe('flightsync-light-backup-DEV-AB12CD34.json');
    expect(meta.parents).toEqual(['FOLDER']);
    expect(meta.appProperties).toMatchObject({
      fslDevice: 'DEV-AB12CD34', fslPlatform: 'android', fslFlights: '1', fslDays: '1', fslArchived: '2',
    });
    expect(typeof meta.appProperties.fslExportedAt).toBe('string');
  });

  it('updates only its own file, with fresh labels', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(okJson({ files: [{ id: 'FOLDER' }] }))
      .mockResolvedValueOnce(okJson({ files: [{ id: 'MINE' }] }))
      .mockResolvedValueOnce(okJson({ id: 'MINE' }));
    await runBackup({ flights: [{ id: 'f' }], residence: [], settings: {}, device: { id: 'DEV-MINE', platform: 'ios' } });
    const [url, init] = globalThis.fetch.mock.calls[2];
    expect(String(url)).toContain('/files/MINE?uploadType=multipart');
    expect(init.method).toBe('PATCH');
    const meta = JSON.parse(await init.body.get('metadata').text());
    expect(meta.appProperties).toMatchObject({ fslDevice: 'DEV-MINE', fslPlatform: 'ios', fslFlights: '1' });
    expect(meta.parents).toBeUndefined();
  });
});

describe('listBackups', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });

  it("lists every device's backup newest first, with the older shared file marked", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(okJson({ files: [{ id: 'FOLDER' }] }))
      .mockResolvedValueOnce(okJson({ files: [
        { id: 'OLD', name: 'flightsync-light-backup.json', modifiedTime: '2026-10-01T00:00:00.000Z' },
        { id: 'MAC', name: 'flightsync-light-backup-DEV-MAC.json', modifiedTime: '2026-11-20T00:00:05.000Z',
          appProperties: { fslDevice: 'DEV-MAC', fslPlatform: 'desktop', fslFlights: '52', fslDays: '120', fslArchived: '311', fslExportedAt: '2026-11-20T00:00:00.000Z' } },
        { id: 'PHN', name: 'flightsync-light-backup-DEV-PHN.json', modifiedTime: '2026-11-24T00:00:05.000Z',
          appProperties: { fslDevice: 'DEV-PHN', fslPlatform: 'ios', fslFlights: '3', fslDays: '140', fslArchived: '0', fslExportedAt: '2026-11-24T00:00:00.000Z' } },
        { id: 'X', name: 'flightsync-light-backup-notes.txt', modifiedTime: '2026-11-25T00:00:00.000Z' },
      ] }));
    const list = await listBackups();
    expect(list.map((b) => b.fileId)).toEqual(['PHN', 'MAC', 'OLD']);
    expect(list[1]).toMatchObject({
      deviceId: 'DEV-MAC', platform: 'desktop', flights: 52, days: 120, archivedFlights: 311,
      exportedAt: '2026-11-20T00:00:00.000Z', legacy: false,
    });
    expect(list[2]).toMatchObject({ fileId: 'OLD', legacy: true, exportedAt: '2026-10-01T00:00:00.000Z' });
  });

  it('returns [] when there is no backup folder yet', async () => {
    globalThis.fetch.mockResolvedValueOnce(okJson({ files: [] }));
    await expect(listBackups()).resolves.toEqual([]);
  });
});
