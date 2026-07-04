// Integration test for M9: the CSV/TSV import branch in App.jsx built flight
// objects and called setImportPreview WITHOUT ever running them through
// isValidFlight, so a CSV `Date` column containing control characters — the
// same shape that enabled the already-fixed ICS-injection vuln (a `date` with
// embedded CRLF reaching DTSTART/DTEND unescaped) — sailed straight into
// state. This locks in that the CSV path now rejects such rows the same way
// the JSON path already does (parseBackupJson), instead of previewing them.
//
// Harness cloned from App.restore-offer.test.jsx / App.folder-backup.test.jsx.

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

// Signed out throughout — irrelevant to CSV import, keeps the Drive
// restore-offer flow out of the way.
vi.mock('../utils/cloudAuth', () => ({
  onAuthChanged: (cb) => { cb(null); return () => {}; },
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../utils/driveBackup', () => ({
  runBackup: vi.fn(async () => {}),
  findBackup: vi.fn(async () => null),
  downloadBackup: vi.fn(async () => ''),
  restoreBlobs: vi.fn(async () => ({ ofps: 0, boardingPasses: 0 })),
  BACKUP_FILENAME: 'flightsync-light-backup.json',
  buildBackupPayload: vi.fn(() => ({})),
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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return utils;
}

// Selects the hidden <input type="file"> App.jsx always renders (line ~1282)
// and drives it through the same reader.readAsText(file) path handleFileImport
// uses outside Tauri.
function importCsvFile(container, text, filename = 'import.csv') {
  const input = container.querySelector('input[type="file"]');
  const file = new File([text], filename, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('CSV import — content validation (M9)', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(cleanup);

  it('rejects a CSV row whose Date cell carries a control character, and never reaches the import preview', async () => {
    const { container } = await renderApp();
    // Bare \r (not \n) survives the parser's line-splitting and lands inside
    // the Date cell — the same "control char inside a validated string field"
    // shape as the fixed ICS vuln.
    const csvText = 'Date,Vol\n2026-05-01\rX-EVIL:injected,AC123\n';

    await act(async () => {
      importCsvFile(container, csvText);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText('Import invalide — certains vols sont mal formés')).toBeTruthy();
    expect(screen.queryByText("Aperçu de l'Import")).toBeNull();
  });

  it('accepts a well-formed CSV row and shows the import preview', async () => {
    const { container } = await renderApp();
    const csvText = 'Date,Vol\n2026-05-01,AC123\n';

    await act(async () => {
      importCsvFile(container, csvText);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText("Aperçu de l'Import")).toBeTruthy();
    expect(screen.getByText('CSV Import')).toBeTruthy();
  });
});
