// Backup safety, App level (review of 2026-11-26):
//  - every backup carries the archived years, and still runs in January when
//    only the archive holds data (it used to skip: "nothing to back up");
//  - each device writes its own Drive file, and a restore lets the pilot pick
//    which device's backup to bring back;
//  - a restore brings archived years (and their flight plans) back;
//  - a backup with an unreadable row restores the rest and says what was left out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';

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

const YEAR = String(new Date().getFullYear());
const LAST_YEAR = String(Number(YEAR) - 1);

let authProfile = { uid: 'test-user', email: 'pilot@example.com' };
vi.mock('../utils/cloudAuth', () => ({
  onAuthChanged: (cb) => { cb(authProfile); return () => {}; },
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));

const runBackupMock = vi.fn(async () => {});
const listBackupsMock = vi.fn(async () => []);
const downloadBackupMock = vi.fn(async () => '');
const restoreBlobsMock = vi.fn(async () => ({ ofps: 0, boardingPasses: 0, skipped: 0 }));
vi.mock('../utils/driveBackup', async () => {
  const actual = await vi.importActual('../utils/driveBackup');
  return {
    ...actual,
    runBackup: (...a) => runBackupMock(...a),
    listBackups: (...a) => listBackupsMock(...a),
    downloadBackup: (...a) => downloadBackupMock(...a),
    restoreBlobs: (...a) => restoreBlobsMock(...a),
  };
});

// In-memory archive store behind archiveStore.js.
let archiveRecords = [];
const saveArchiveYearMock = vi.fn(async (rec) => {
  archiveRecords = [...archiveRecords.filter((r) => r.year !== rec.year), rec];
});
vi.mock('@flightsync/core/idb', () => ({
  getAllBoardingPassDates: async () => new Set(),
  getAllOFPFlightIds: async () => new Set(),
  getAllBoardingPassInfo: async () => [],
  getAllArchiveYears: async () => archiveRecords,
  getArchiveYear: async (y) => archiveRecords.find((r) => r.year === y) || null,
  saveArchiveYear: (...a) => saveArchiveYearMock(...a),
  getOFP: async () => null,
}));
vi.mock('../utils/icsExport', () => ({ exportICS: vi.fn() }));
vi.mock('../components/tabs/DashboardTab', () => ({ default: () => <div data-testid="tab-dashboard" /> }));
vi.mock('../components/tabs/CalendarTab', () => ({ default: () => <div data-testid="tab-calendar" /> }));
vi.mock('../components/tabs/BackupTab', () => ({ default: () => <div data-testid="tab-backup" /> }));
vi.mock('../components/tabs/DataTab', () => ({ default: () => <div data-testid="tab-data" /> }));
vi.mock('../components/tabs/ArchiveTab', () => ({ default: () => <div data-testid="tab-archive" /> }));
vi.mock('../components/tabs/HistoryTab', () => ({ default: () => <div data-testid="tab-history" /> }));

import App from '../App.jsx';

const AUTO_BACKUP_DELAY_MS = 3 * 60 * 1000;
const liveFlight = { id: 'l1', date: `${YEAR}-03-10`, flightNumber: 'AC0871', departure: 'YUL', arrival: 'DEL', totalTime: 13.3, canadianTime: 4 };
const archivedFlight = { id: 'a1', date: `${LAST_YEAR}-12-30`, flightNumber: 'AC0051', departure: 'DEL', arrival: 'YUL', totalTime: 14.5, canadianTime: 2 };
const archiveRecord = { year: LAST_YEAR, flights: [archivedFlight], residence: [], manifest: null, archivedAt: null };
const drivePayload = (o) => JSON.stringify({ schemaVersion: 1, exportedAt: `${YEAR}-11-20T00:00:00.000Z`, flights: [], residence: [], settings: {}, ...o });
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

async function renderApp() {
  const utils = render(<App />);
  await screen.findByText('Flight Sync System');
  await flush();
  return utils;
}

beforeEach(() => {
  authProfile = { uid: 'test-user', email: 'pilot@example.com' };
  archiveRecords = [];
  window.localStorage.clear();
  [runBackupMock, listBackupsMock, downloadBackupMock, restoreBlobsMock, saveArchiveYearMock].forEach((m) => m.mockClear());
  listBackupsMock.mockResolvedValue([]);
});
afterEach(cleanup);

describe('Drive backups carry the archived years', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("sends the archived years and this device's id with every backup", async () => {
    window.localStorage.setItem('ac-flights-data', JSON.stringify([liveFlight]));
    archiveRecords = [archiveRecord];
    await renderApp();
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DELAY_MS); });
    expect(runBackupMock).toHaveBeenCalledTimes(1);
    expect(runBackupMock).toHaveBeenCalledWith(expect.objectContaining({
      archives: [expect.objectContaining({ year: LAST_YEAR, flights: [expect.objectContaining({ id: 'a1' })] })],
      device: expect.objectContaining({ id: expect.stringMatching(/^DEV-/) }),
    }));
  });

  it('still backs up in January, when only the archived years hold data', async () => {
    archiveRecords = [archiveRecord];
    await renderApp();
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DELAY_MS); });
    expect(runBackupMock).toHaveBeenCalledTimes(1);
  });
});

describe('restoring from Drive', () => {
  const PHONE = { fileId: 'PHN', deviceId: 'DEV-PHN', platform: 'ios', flights: 3, days: 140, archivedFlights: 0, exportedAt: `${YEAR}-11-24T00:00:00.000Z`, legacy: false };
  const MAC = { fileId: 'MAC', deviceId: 'DEV-MAC', platform: 'desktop', flights: 52, days: 120, archivedFlights: 311, exportedAt: `${YEAR}-11-20T00:00:00.000Z`, legacy: false };

  // In January the live lists are empty but the archive holds last year: that
  // device is not "empty", and replacing its data with a Drive snapshot is wrong.
  it('does not offer a restore to a device whose archive holds data', async () => {
    archiveRecords = [archiveRecord];
    listBackupsMock.mockResolvedValue([MAC]);
    await renderApp();
    await flush();
    expect(screen.queryByText('Backup found on Google Drive')).toBeNull();
    expect(listBackupsMock).not.toHaveBeenCalled();
  });

  it("lists each device's backup and restores the one picked", async () => {
    listBackupsMock.mockResolvedValue([PHONE, MAC]);
    downloadBackupMock.mockResolvedValue(drivePayload({ flights: [liveFlight] }));
    await renderApp();
    await screen.findByText('Backup found on Google Drive');
    expect(screen.getByLabelText(/iPhone/).checked).toBe(true); // newest first, preselected
    fireEvent.click(screen.getByLabelText(/Mac/));
    await act(async () => { fireEvent.click(screen.getByText('Restore')); });
    await flush();
    expect(downloadBackupMock).toHaveBeenCalledWith('MAC');
  });

  it('brings the archived years back, with the flight plans of archived flights', async () => {
    listBackupsMock.mockResolvedValue([MAC]);
    downloadBackupMock.mockResolvedValue(drivePayload({
      flights: [liveFlight],
      archives: [{ year: LAST_YEAR, flights: [archivedFlight], residence: [] }],
    }));
    await renderApp();
    await screen.findByText('Backup found on Google Drive');
    await act(async () => { fireEvent.click(screen.getByText('Restore')); });
    await waitFor(() => expect(saveArchiveYearMock).toHaveBeenCalled());
    expect(saveArchiveYearMock).toHaveBeenCalledWith(expect.objectContaining({
      year: LAST_YEAR, flights: [expect.objectContaining({ id: 'a1' })],
    }));
    const blobFlights = restoreBlobsMock.mock.calls[0][0].map((f) => f.id);
    expect(blobFlights).toEqual(expect.arrayContaining(['l1', 'a1']));
  });

  it('restores the readable rows and says which row was left out', async () => {
    listBackupsMock.mockResolvedValue([MAC]);
    downloadBackupMock.mockResolvedValue(drivePayload({
      flights: [liveFlight, { ...liveFlight, id: 'bad', date: 'first of March', flightNumber: 'AC0051' }],
    }));
    await renderApp();
    await screen.findByText('Backup found on Google Drive');
    await act(async () => { fireEvent.click(screen.getByText('Restore')); });
    expect(await screen.findByText(/could not be read/)).toBeTruthy();
    expect(screen.getByText(/AC0051/)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('ac-flights-data')).map((f) => f.id)).toEqual(['l1']);
  });
});

describe('importing a JSON backup file', () => {
  it('shows the archived years and the left-out row, and restores the archived years', async () => {
    await renderApp();
    const text = JSON.stringify({
      version: '2.0.0', exportDate: `${YEAR}-11-20T00:00:00.000Z`, deviceId: 'DEV-MAC',
      data: {
        flights: [liveFlight, { ...liveFlight, id: 'bad', date: 'first of March', flightNumber: 'AC0051' }],
        residence: [],
        archives: [{ year: LAST_YEAR, flights: [archivedFlight], residence: [] }],
      },
    });
    const input = document.querySelector('input[type="file"]');
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([text], 'backup.json', { type: 'application/json' })] } });
    });
    expect(await screen.findByText(/1 archived year/)).toBeTruthy();
    expect(screen.getByText(/AC0051/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText('Replace all')); });
    await waitFor(() => expect(saveArchiveYearMock).toHaveBeenCalledWith(expect.objectContaining({ year: LAST_YEAR })));
  });
});
