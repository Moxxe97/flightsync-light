// Integration tests for the debounced folder auto-backup and folder restore
// (Tasks C3 + C4).
//
// The harness is cloned from App.auto-backup.test.jsx:
//   - Same localStorage polyfill
//   - Same auth / idb / icsExport / tab stubs
//   - Fake timers to cross the 3-minute debounce window
//
// New seams:
//   - runFolderBackup / restoreFolderBlobs (folderBackup module)
//   - readTextFile (@tauri-apps/plugin-fs)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// jsdom ships without a usable localStorage — install a minimal polyfill
// before App is imported (App reads/writes it during startup).
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

// ─── Auth: always signed in (folder backup does NOT need authUser) ───
vi.mock('../utils/cloudAuth', () => ({
  onAuthChanged: (cb) => { cb({ uid: 'test-user' }); return () => {}; },
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));

// ─── Drive backup seam (not under test here — just needs to be silent) ───
vi.mock('../utils/driveBackup', () => ({
  runBackup: vi.fn(async () => {}),
  findBackup: vi.fn(async () => null),
  downloadBackup: vi.fn(async () => ''),
  restoreBlobs: vi.fn(async () => ({ ofps: 0, boardingPasses: 0 })),
  BACKUP_FILENAME: 'flightsync-light-backup.json',
  buildBackupPayload: vi.fn(() => ({})),
}));

// ─── The folder backup seams we assert on ───
const runFolderBackupMock = vi.fn(async () => ({ ofps: 0, boardingPasses: 0 }));
const restoreFolderBlobsMock = vi.fn(async () => ({ ofps: 0, boardingPasses: 0 }));
vi.mock('../utils/folderBackup', () => ({
  runFolderBackup: (...args) => runFolderBackupMock(...args),
  restoreFolderBlobs: (...args) => restoreFolderBlobsMock(...args),
}));

// ─── @tauri-apps/plugin-fs: provide readTextFile for the restore test ───
const readTextFileMock = vi.fn(async () => '');
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: (...args) => readTextFileMock(...args),
  writeTextFile: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  exists: vi.fn(async () => false),
  readDir: vi.fn(async () => []),
  readFile: vi.fn(async () => new Uint8Array()),
}));

// ─── Side-effecting startup deps ───
vi.mock('@flightsync/core/idb', () => ({
  getAllBoardingPassDates: async () => [],
  getAllOFPFlightIds: async () => [],
  getAllBoardingPassInfo: async () => [],
  getAllArchiveYears: async () => [],
}));
vi.mock('../utils/icsExport', () => ({
  exportICS: vi.fn(),
}));

// Stub the tab bodies cheaply; except BackupTab which we need for C4.
vi.mock('../components/tabs/DashboardTab', () => ({ default: () => <div data-testid="tab-dashboard" /> }));
vi.mock('../components/tabs/CalendarTab', () => ({ default: () => <div data-testid="tab-calendar" /> }));
vi.mock('../components/tabs/DataTab', () => ({ default: () => <div data-testid="tab-data" /> }));
vi.mock('../components/tabs/ArchiveTab', () => ({ default: () => <div data-testid="tab-archive" /> }));
vi.mock('../components/tabs/HistoryTab', () => ({ default: () => <div data-testid="tab-history" /> }));

import App from '../App.jsx';

const AUTO_BACKUP_DELAY_MS = 3 * 60 * 1000;

// A valid backup JSON in the Drive/folder shape that parseBackupJson accepts.
const BACKUP_JSON = JSON.stringify({
  version: '2.0.0',
  data: {
    flights: [{
      id: 'imp-1', date: '2026-06-12', flightNumber: 'AC871',
      departure: 'YUL', arrival: 'DEL', totalTime: 13.3, canadianTime: 4,
      distance: 3402, canadianDistance: 612,
    }],
    residence: [],
    settings: {},
  },
});

// A minimal Drive-shape backup JSON returned by readTextFile (for restore test).
const FOLDER_BACKUP_JSON = JSON.stringify({
  schemaVersion: 1,
  exportedAt: '2026-06-12T00:00:00Z',
  flights: [{ id: 'r-1', date: '2026-03-15', flightNumber: 'AC123' }],
  residence: [],
});

// Render App and wait for isLoading to become false.
async function renderApp() {
  const utils = render(<App />);
  await screen.findByText('Flight Sync System');
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return utils;
}

// Import a JSON backup through the real hidden file input → preview modal →
// "Remplacer tout" to trigger a real setFlights (which is what the scheduler watches).
async function importBackup(text) {
  const input = document.querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  const file = new File([text], 'backup.json', { type: 'application/json' });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
  });
  const replaceBtn = await screen.findByText('Remplacer tout');
  await act(async () => {
    fireEvent.click(replaceBtn);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App debounced folder auto-backup', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    runFolderBackupMock.mockClear();
    restoreFolderBlobsMock.mockClear();
    readTextFileMock.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it('debounced auto-backup fires the folder destination when configured', async () => {
    // Seed settings with a backupFolder before rendering — App reads them via loadAllData.
    window.localStorage.setItem('ac-sync-settings', JSON.stringify({ backupFolder: '/Users/x/FlightSync' }));
    // Seed one flight so the empty-state guard doesn't block the backup.
    window.localStorage.setItem('ac-flights-data', JSON.stringify([{
      id: 'seed-1', date: '2026-06-12', flightNumber: 'AC871',
      departure: 'YUL', arrival: 'DEL', totalTime: 13.3, canadianTime: 4,
      distance: 3402, canadianDistance: 612,
    }]));

    await renderApp();

    // Import triggers a data change so the debounce effect re-arms.
    await importBackup(BACKUP_JSON);

    // Debounce window not yet elapsed — nothing should have fired.
    expect(runFolderBackupMock).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DELAY_MS); });

    expect(runFolderBackupMock).toHaveBeenCalledTimes(1);
    expect(runFolderBackupMock).toHaveBeenCalledWith(
      expect.objectContaining({ folder: '/Users/x/FlightSync' }),
    );
  });

  it('no folder configured → folder backup never fires', async () => {
    // Settings without backupFolder (uses the default empty string).
    window.localStorage.setItem('ac-flights-data', JSON.stringify([{
      id: 'seed-2', date: '2026-06-12', flightNumber: 'AC872',
      departure: 'YUL', arrival: 'CDG', totalTime: 8.2, canadianTime: 2,
      distance: 3000, canadianDistance: 400,
    }]));

    await renderApp();
    await importBackup(BACKUP_JSON);

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DELAY_MS * 2); });

    expect(runFolderBackupMock).not.toHaveBeenCalled();
  });
});

describe('App restore from folder', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    runFolderBackupMock.mockClear();
    restoreFolderBlobsMock.mockClear();
    readTextFileMock.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it('restore from folder feeds the JSON through the existing import preview', async () => {
    // Seed a backupFolder in settings.
    window.localStorage.setItem('ac-sync-settings', JSON.stringify({ backupFolder: '/Users/x/FlightSync' }));
    // readTextFile will return a valid backup JSON when the restore path calls it.
    readTextFileMock.mockResolvedValue(FOLDER_BACKUP_JSON);

    await renderApp();

    // Navigate to the Backup tab.
    const backupTabBtn = screen.getByRole('button', { name: /Backup|Sauvegardes/i });
    await act(async () => { fireEvent.click(backupTabBtn); });

    // Click "Restaurer depuis le dossier".
    const restoreBtn = await screen.findByRole('button', { name: /Restaurer depuis le dossier/i });
    await act(async () => {
      fireEvent.click(restoreBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The import-preview modal should appear.
    await screen.findByText('Aperçu de l\'Import');

    // Check that the flight count and residence count appear (1 vol, 0 résidence).
    const counts = screen.getAllByText(/\d+/);
    const flightCount = counts.find((el) => el.textContent === '1');
    expect(flightCount).toBeTruthy();

    // JOURS RÉSIDENCE label should show 0.
    expect(screen.getByText('0')).toBeTruthy();
  });
});
