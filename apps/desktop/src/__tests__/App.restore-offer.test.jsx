// Integration test for the proactive Drive restore offer in App.jsx (Task 10).
// Behaviour under test:
//   - signed in + empty local store + findBackup resolves { fileId }
//     -> the "Sauvegarde trouvée sur Google Drive" ConfirmModal appears
//   - confirming "Restaurer" -> restoreFromDrive runs: downloadBackup(fileId)
//     is called, the parsed snapshot replaces local state.
//
// Mirrors App.auto-backup.test.jsx's mock set + render harness. The driveBackup
// module is the seam we assert on.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// jsdom localStorage polyfill (installed before App import).
(() => {
  const store = new Map();
  const mock = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: mock });
})();

let authProfile = { uid: 'test-user', email: 'pilote@example.com' };
vi.mock('../utils/cloudAuth', () => ({
  onAuthChanged: (cb) => { cb(authProfile); return () => {}; },
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));

// ─── The Drive seam we assert on ───
const findBackupMock = vi.fn(async () => ({ fileId: 'BACKUP_FILE_ID' }));
const BACKUP_SNAPSHOT = JSON.stringify({
  schemaVersion: 1,
  exportedAt: '2026-06-11T00:00:00.000Z',
  flights: [{ id: 'r1', date: '2026-05-01', flightNumber: 'AC123', departure: 'YUL', arrival: 'YYZ' }],
  residence: [],
  settings: {},
});
const downloadBackupMock = vi.fn(async () => BACKUP_SNAPSHOT);
const restoreBlobsMock = vi.fn(async () => ({ ofps: 0, boardingPasses: 0 }));
vi.mock('../utils/driveBackup', () => ({
  runBackup: vi.fn(async () => {}),
  findBackup: (...a) => findBackupMock(...a),
  downloadBackup: (...a) => downloadBackupMock(...a),
  restoreBlobs: (...a) => restoreBlobsMock(...a),
}));

vi.mock('@flightsync/core/idb', () => ({
  getAllBoardingPassDates: async () => new Set(),
  getAllOFPFlightIds: async () => new Set(),
  getAllBoardingPassInfo: async () => [],
  getAllArchiveYears: async () => [],
}));
vi.mock('../utils/icsExport', () => ({
  exportICS: vi.fn(),
}));

vi.mock('../components/tabs/DashboardTab', () => ({ default: () => <div data-testid="tab-dashboard" /> }));
vi.mock('../components/tabs/CalendarTab', () => ({ default: () => <div data-testid="tab-calendar" /> }));
vi.mock('../components/tabs/BackupTab', () => ({ default: () => <div data-testid="tab-backup" /> }));
vi.mock('../components/tabs/DataTab', () => ({ default: () => <div data-testid="tab-data" /> }));
vi.mock('../components/tabs/ArchiveTab', () => ({ default: () => <div data-testid="tab-archive" /> }));
vi.mock('../components/tabs/HistoryTab', () => ({ default: () => <div data-testid="tab-history" /> }));

import App from '../App.jsx';

async function renderApp() {
  const utils = render(<App />);
  await screen.findByText('Flight Sync System');
  // Flush init effect (device id + loadAllData) so isLoading becomes false; the
  // restore-offer effect bails while isLoading is true.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return utils;
}

describe('App proactive Drive restore offer', () => {
  beforeEach(() => {
    authProfile = { uid: 'test-user', email: 'pilote@example.com' };
    findBackupMock.mockClear();
    downloadBackupMock.mockClear();
    restoreBlobsMock.mockClear();
    window.localStorage.clear();
  });
  afterEach(cleanup);

  it('signed in + empty + backup found: offers, and confirming restores via downloadBackup(fileId)', async () => {
    await renderApp();

    // The offer modal appears (findBackup resolved { fileId }).
    const modalTitle = await screen.findByText('Sauvegarde trouvée sur Google Drive');
    expect(modalTitle).toBeTruthy();
    expect(findBackupMock).toHaveBeenCalled();

    // Confirm "Restaurer" → restoreFromDrive path.
    await act(async () => {
      fireEvent.click(screen.getByText('Restaurer'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(downloadBackupMock).toHaveBeenCalledWith('BACKUP_FILE_ID');
    expect(restoreBlobsMock).toHaveBeenCalled();
  });

  it('signed out: no restore offer', async () => {
    authProfile = null;
    await renderApp();
    expect(screen.queryByText('Sauvegarde trouvée sur Google Drive')).toBeNull();
    expect(findBackupMock).not.toHaveBeenCalled();
  });
});
