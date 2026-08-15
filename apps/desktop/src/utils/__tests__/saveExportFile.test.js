// Mobile WebViews silently swallow the blob+<a download> idiom (verified
// on-device in the sibling FlightSync app 2026-08-15: success toast, no file),
// so exports route per platform: browser download on desktop, MediaStore
// Downloads via save_export_file on Android, app Documents (Files-app-visible)
// via plugin-fs on iOS.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async () => {}),
  BaseDirectory: { Document: 6 },
}));
vi.mock('../platform', () => ({ getPlatform: vi.fn() }));

const { invoke } = await import('@tauri-apps/api/core');
const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
const { getPlatform } = await import('../platform');
const { saveExportFile } = await import('../saveExportFile');

describe('saveExportFile', () => {
  let clickSpy;
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => {
    clickSpy.mockRestore();
    delete window.__TAURI_INTERNALS__;
  });

  it('plain browser (no Tauri): anchor download, never asks the platform', async () => {
    delete window.__TAURI_INTERNALS__;
    const res = await saveExportFile('x.csv', 'a,b', 'text/csv;charset=utf-8');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ location: 'browser' });
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it('Tauri desktop: browser download', async () => {
    window.__TAURI_INTERNALS__ = {};
    getPlatform.mockResolvedValue('desktop');
    const res = await saveExportFile('x.csv', 'a,b', 'text/csv;charset=utf-8');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(res.location).toBe('browser');
  });

  it('Tauri Android: saves via save_export_file into Downloads', async () => {
    window.__TAURI_INTERNALS__ = {};
    getPlatform.mockResolvedValue('android');
    invoke.mockResolvedValue('Download/x.csv');
    const res = await saveExportFile('x.csv', 'a,b', 'text/csv;charset=utf-8');
    expect(invoke).toHaveBeenCalledWith('save_export_file', {
      fileName: 'x.csv', mime: 'text/csv;charset=utf-8', contents: 'a,b',
    });
    expect(res).toEqual({ location: 'downloads', path: 'Download/x.csv' });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('Tauri iOS: writes to app Documents via plugin-fs (Files-app visible)', async () => {
    window.__TAURI_INTERNALS__ = {};
    getPlatform.mockResolvedValue('ios');
    const res = await saveExportFile('x.ics', 'BEGIN:VCALENDAR', 'text/calendar;charset=utf-8');
    expect(writeTextFile).toHaveBeenCalledWith('x.ics', 'BEGIN:VCALENDAR', { baseDir: BaseDirectory.Document });
    expect(res).toEqual({ location: 'documents', path: 'x.ics' });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('propagates a save failure so the caller can show an error toast', async () => {
    window.__TAURI_INTERNALS__ = {};
    getPlatform.mockResolvedValue('android');
    invoke.mockRejectedValue(new Error('disk full'));
    await expect(saveExportFile('x.csv', 'a', 'text/csv')).rejects.toThrow('disk full');
  });
});
