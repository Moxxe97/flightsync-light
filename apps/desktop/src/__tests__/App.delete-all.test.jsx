// "Delete ALL data" (review of 2026-11-26): wipes everything on this device and
// signs out of Google and disconnects the backup folder first, so the next
// backup cannot overwrite this device's backups with an almost empty app.
// The backups themselves (Drive, folder) are never touched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';

(() => {
  const store = new Map();
  const mock = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: mock });
})();

const signOutMock = vi.fn(async () => {});
vi.mock('../utils/cloudAuth', () => ({
  onAuthChanged: (cb) => { cb({ uid: 'test-user', email: 'pilot@example.com' }); return () => {}; },
  signInWithGoogle: vi.fn(),
  signOut: (...a) => signOutMock(...a),
}));

const wipeMock = vi.fn(async () => ({ failed: [] }));
const forgetFolderMock = vi.fn(async () => {});
vi.mock('../utils/folderBackup', async () => {
  const actual = await vi.importActual('../utils/folderBackup');
  return { ...actual, forgetBackupFolder: (...a) => forgetFolderMock(...a) };
});
vi.mock('../utils/wipeDevice', () => ({ wipeLocalData: (...a) => wipeMock(...a) }));

vi.mock('../utils/driveBackup', async () => {
  const actual = await vi.importActual('../utils/driveBackup');
  return { ...actual, runBackup: vi.fn(async () => {}), listBackups: vi.fn(async () => []) };
});
vi.mock('@flightsync/core/idb', () => ({
  getAllBoardingPassDates: async () => new Set(),
  getAllOFPFlightIds: async () => new Set(),
  getAllBoardingPassInfo: async () => [],
  getAllArchiveYears: async () => [],
  getArchiveYear: async () => null,
  saveArchiveYear: async () => {},
  getOFP: async () => null,
}));
vi.mock('../utils/icsExport', () => ({ exportICS: vi.fn() }));
vi.mock('../components/tabs/DashboardTab', () => ({ default: () => <div data-testid="tab-dashboard" /> }));
vi.mock('../components/tabs/CalendarTab', () => ({ default: () => <div data-testid="tab-calendar" /> }));
vi.mock('../components/tabs/BackupTab', () => ({
  default: ({ clearAllData }) => <button onClick={clearAllData}>Delete all data</button>,
}));
vi.mock('../components/tabs/DataTab', () => ({ default: () => <div data-testid="tab-data" /> }));
vi.mock('../components/tabs/ArchiveTab', () => ({ default: () => <div data-testid="tab-archive" /> }));
vi.mock('../components/tabs/HistoryTab', () => ({ default: () => <div data-testid="tab-history" /> }));

import App from '../App.jsx';

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

async function deleteAll() {
  render(<App />);
  await screen.findByText('Flight Sync System');
  await flush();
  fireEvent.click(screen.getAllByText('Backup & Restore')[0]);
  fireEvent.click(await screen.findByText('Delete all data'));
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('ac-flights-data', JSON.stringify([{ id: 'f1', date: '2026-03-10', flightNumber: 'AC0871' }]));
  window.localStorage.setItem('ac-sync-settings', JSON.stringify({ backupReminder: 14, backupFolder: '/Users/x/Backups' }));
  signOutMock.mockClear();
  wipeMock.mockReset();
  wipeMock.mockResolvedValue({ failed: [] });
});
afterEach(cleanup);

describe('Delete ALL data', () => {
  it('says what is deleted, and that the backups are kept', async () => {
    await deleteAll();
    expect(screen.getByText(/archived years/)).toBeTruthy();
    expect(screen.getByText(/backups on Google Drive and in your backup folder are kept/)).toBeTruthy();
  });

  it('signs out and disconnects the backup folder before wiping', async () => {
    await deleteAll();
    await act(async () => { fireEvent.click(screen.getByText('Delete')); });
    await waitFor(() => expect(wipeMock).toHaveBeenCalled());
    expect(signOutMock).toHaveBeenCalled();
    expect(signOutMock.mock.invocationCallOrder[0]).toBeLessThan(wipeMock.mock.invocationCallOrder[0]);
    expect(JSON.parse(window.localStorage.getItem('ac-sync-settings'))).toEqual(expect.objectContaining({ backupReminder: 14, backupFolder: '' }));
    expect(forgetFolderMock).toHaveBeenCalled(); // Rust forgets the picked folder too
    expect(await screen.findByText(/All data on this device has been deleted/)).toBeTruthy();
  });

  it('says which part could not be deleted', async () => {
    wipeMock.mockResolvedValue({ failed: ['boarding passes'] });
    await deleteAll();
    await act(async () => { fireEvent.click(screen.getByText('Delete')); });
    expect(await screen.findByText(/could not be deleted: boarding passes/)).toBeTruthy();
  });

  it('does not delete anything when cancelled', async () => {
    await deleteAll();
    fireEvent.click(screen.getByText('Cancel'));
    await flush();
    expect(wipeMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });
});
