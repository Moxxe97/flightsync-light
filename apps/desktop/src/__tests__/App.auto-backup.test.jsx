// Integration test for the debounced Drive auto-backup scheduler in App.jsx
// (Task 9). The behaviour under test is the *debounce*:
//   - signed in + a data change  -> exactly one runBackup(includeBlobs:true)
//                                    after AUTO_BACKUP_DELAY_MS (3 min)
//   - two changes < 3 min apart  -> still exactly one call (timer resets)
//   - signed out                 -> never fires
//
// We render the REAL App with the heavy auth/idb/calendar/Drive deps mocked
// (same mock set as App.mobile-shell.test.jsx), drive a data change through a
// real UI action (importing a JSON backup via the hidden file input), and
// advance Vitest's fake timers to cross the debounce window. runBackup is the
// mocked seam we assert on — the timer/effect wiring is exercised for real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// jsdom here ships without a usable localStorage; install a minimal polyfill
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

// ─── Auth: flip between signed-in and signed-out per test ───
let authProfile = { uid: 'test-user' };
vi.mock('../utils/cloudAuth', () => ({
  onAuthChanged: (cb) => { cb(authProfile); return () => {}; },
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));

// ─── The Drive backup seam we assert on ───
const runBackupMock = vi.fn(async () => {});
vi.mock('../utils/driveBackup', () => ({
  runBackup: (...args) => runBackupMock(...args),
  findBackup: vi.fn(async () => null),
  downloadBackup: vi.fn(async () => ''),
  restoreBlobs: vi.fn(async () => ({ ofps: 0, boardingPasses: 0 })),
}));

// ─── Side-effecting startup deps (idb / calendar) ───
vi.mock('@flightsync/core/idb', () => ({
  getAllBoardingPassDates: async () => [],
  getAllOFPFlightIds: async () => [],
  getAllBoardingPassInfo: async () => [],
  getAllArchiveYears: async () => [],
}));
vi.mock('../utils/icsExport', () => ({
  exportICS: vi.fn(),
}));

// Stub the tab bodies so the tree renders cheaply; we drive changes through the
// hidden file input that App.jsx renders outside the tabs.
vi.mock('../components/tabs/DashboardTab', () => ({ default: () => <div data-testid="tab-dashboard" /> }));
vi.mock('../components/tabs/CalendarTab', () => ({ default: () => <div data-testid="tab-calendar" /> }));
vi.mock('../components/tabs/BackupTab', () => ({ default: () => <div data-testid="tab-backup" /> }));
vi.mock('../components/tabs/DataTab', () => ({ default: () => <div data-testid="tab-data" /> }));
vi.mock('../components/tabs/ArchiveTab', () => ({ default: () => <div data-testid="tab-archive" /> }));
vi.mock('../components/tabs/HistoryTab', () => ({ default: () => <div data-testid="tab-history" /> }));

import App from '../App.jsx';

const AUTO_BACKUP_DELAY_MS = 3 * 60 * 1000;

// A valid JSON backup the importer accepts — at least one flight so the import
// produces a real `flights` state change (which is what the scheduler watches).
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

// Render App and let the queued auth callback + async init settle to isLoading=false.
async function renderApp() {
  const utils = render(<App />);
  await screen.findByText('Flight Sync System');
  // Flush the init effect's microtasks (device id + loadAllData) so isLoading
  // becomes false — the scheduler effect bails while isLoading is true.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return utils;
}

// Import a JSON backup through the real hidden file input → preview modal →
// "Remplacer tout", which calls setFlights — a real App data change the
// scheduler effect observes.
async function importBackup(text) {
  const input = document.querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  const file = new File([text], 'backup.json', { type: 'application/json' });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
    // FileReader.onload fires on a macrotask in jsdom; flush timers + microtasks
    // so parseBackupJson + setImportPreview run and the preview modal mounts.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
  });
  // Confirm the import (replace strategy) → setFlights.
  const replaceBtn = await screen.findByText('Remplacer tout');
  await act(async () => {
    fireEvent.click(replaceBtn);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App debounced Drive auto-backup', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    authProfile = { uid: 'test-user' };
    runBackupMock.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it('signed in: a flights change triggers exactly one backup after 3 min, with includeBlobs:true', async () => {
    await renderApp();
    await importBackup(BACKUP_JSON);

    // Nothing yet — the debounce window has not elapsed.
    expect(runBackupMock).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DELAY_MS); });

    expect(runBackupMock).toHaveBeenCalledTimes(1);
    expect(runBackupMock).toHaveBeenCalledWith(expect.objectContaining({ includeBlobs: true }));
  });

  it('two changes 1 min apart: timer resets, still exactly one backup', async () => {
    await renderApp();
    await importBackup(BACKUP_JSON);

    // First change armed the timer; advance 1 min (< 3 min) — no fire yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000); });
    expect(runBackupMock).not.toHaveBeenCalled();

    // Second change reschedules (clears + re-arms) the timer.
    await importBackup(BACKUP_JSON);
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000); });
    // 2 min after the first change, 1 min after the second — still nothing.
    expect(runBackupMock).not.toHaveBeenCalled();

    // Cross 3 min from the SECOND change.
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60 * 1000); });
    expect(runBackupMock).toHaveBeenCalledTimes(1);
  });

  it('after a successful backup: stamps fsl-last-backup and does NOT self-retrigger (no re-arm loop)', async () => {
    await renderApp();
    await importBackup(BACKUP_JSON);

    // Cross the debounce window → exactly one backup runs.
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DELAY_MS); });
    // Flush the runBackup promise + the success setBackupState so the success
    // path (which writes localStorage) has executed.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(runBackupMock).toHaveBeenCalledTimes(1);
    // The success path persists lastBackup OUTSIDE settings, in localStorage.
    expect(window.localStorage.getItem('fsl-last-backup')).toBeTruthy();

    // A successful backup must not re-arm the scheduler. Advance well past
    // another full debounce window with NO data change — if lastBackup lived in
    // `settings` state, the success write would have rescheduled a 2nd backup.
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DELAY_MS * 2); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(runBackupMock).toHaveBeenCalledTimes(1);
  });

  it('signed out: a flights change never triggers a backup', async () => {
    authProfile = null; // onAuthChanged delivers null → authUser stays null
    await renderApp();
    await importBackup(BACKUP_JSON);

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DELAY_MS * 2); });
    expect(runBackupMock).not.toHaveBeenCalled();
  });

  // Regression for the data-loss bug: signed in on a FRESH/empty install (e.g.
  // the proactive restore offer was declined → local state stays empty). The
  // scheduler must NOT run a backup, because runBackup PATCHes the existing
  // Drive doc in place and would overwrite the user's only backup with [] / [].
  it('signed in but EMPTY (no imports): never backs up, even past the debounce window', async () => {
    await renderApp();
    // No import — flights:[] residence:[] stay empty.

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_BACKUP_DELAY_MS * 2); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(runBackupMock).not.toHaveBeenCalled();
  });
});
