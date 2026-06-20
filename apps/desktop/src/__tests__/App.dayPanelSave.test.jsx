// Integration test for the combined DayPanel — Tasks B1+B3.
// Renders the REAL App (CalendarTab NOT mocked), clicks a calendar day cell,
// and drives the DayPanel UI to assert that handleDayPanelSave correctly
// persists entries to localStorage ac-residence-data.
//
// Tests 1–4 cover:
//   1. Clicking 'Canada' classification → persists { date, location: 'canada', _source: 'manual' }
//   2. Clicking 'Mexique' + typing a note → persists { location: 'mexico', notes: 'hôtel Riu' }
//   3. Note-only (no classification) then Fermer → persists { location: null, notes: … }
//   4. With a seeded entry, clicking Effacer + clearing textarea then Fermer → removes the entry

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// jsdom ships without a usable localStorage; install in-memory polyfill.
const _lsStore = new Map();
const _lsMock = {
  getItem: (k) => (_lsStore.has(k) ? _lsStore.get(k) : null),
  setItem: (k, v) => { _lsStore.set(k, String(v)); },
  removeItem: (k) => { _lsStore.delete(k); },
  clear: () => { _lsStore.clear(); },
};
Object.defineProperty(window, 'localStorage', { configurable: true, value: _lsMock });

// ─── Auth: signed-in profile ───
vi.mock('../utils/cloudAuth', () => ({
  onAuthChanged: (cb) => { cb({ uid: 'test-user' }); return () => {}; },
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));

// ─── Drive seam ───
vi.mock('../utils/driveBackup', () => ({
  runBackup: vi.fn(async () => {}),
  findBackup: vi.fn(async () => null),
  downloadBackup: vi.fn(async () => ''),
  restoreBlobs: vi.fn(async () => ({ ofps: 0, boardingPasses: 0 })),
}));

// ─── idb: minimal stubs ───
vi.mock('@flightsync/core/idb', () => ({
  getAllBoardingPassDates: async () => new Set(),
  getAllOFPFlightIds: async () => [],
  getAllBoardingPassInfo: async () => [],
  getAllArchiveYears: async () => [],
  getBoardingPassesForDate: async () => [],
  saveBoardingPass: vi.fn(async () => 1),
  deleteBoardingPass: vi.fn(async () => {}),
  bpToObjectURL: vi.fn(() => 'blob:fake'),
}));

vi.mock('../utils/icsExport', () => ({
  exportICS: vi.fn(),
}));

// Stub heavy tabs that don't affect the day-panel test surface.
// CalendarTab is NOT mocked — we need real cell renders + onClick.
vi.mock('../components/tabs/DashboardTab', () => ({ default: () => <div data-testid="tab-dashboard" /> }));
vi.mock('../components/tabs/BackupTab', () => ({ default: () => <div data-testid="tab-backup" /> }));
vi.mock('../components/tabs/DataTab', () => ({ default: () => <div data-testid="tab-data" /> }));
vi.mock('../components/tabs/ArchiveTab', () => ({ default: () => <div data-testid="tab-archive" /> }));
vi.mock('../components/tabs/HistoryTab', () => ({ default: () => <div data-testid="tab-history" /> }));

import App from '../App.jsx';

// Render App, navigate to Calendar tab, and wait for it to settle.
async function renderApp() {
  const utils = render(<App />);
  await screen.findByText('Flight Sync System');
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // Click the Calendar tab
  const calBtn = screen.getByRole('button', { name: /calendrier/i });
  await act(async () => { fireEvent.click(calBtn); });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

// Click any visible day cell by its text number (picks the first match).
// CalendarTab cells are divs with an onClick and a title attribute.
function clickDayCell(dayNumber) {
  // Day cells contain a <span> with the day number text.
  // We find the closest clickable parent div (the cell itself).
  const spans = Array.from(document.querySelectorAll('div[style*="aspect-ratio"]'));
  const cell = spans.find((el) => {
    const span = el.querySelector('span');
    return span && span.textContent.trim() === String(dayNumber);
  });
  if (!cell) throw new Error(`Day cell ${dayNumber} not found`);
  fireEvent.click(cell);
}

const TEST_DATE = `${new Date().getFullYear()}-01-15`;
const TEST_DAY = 15; // January 15 — always rendered in the current year

beforeEach(() => {
  _lsStore.clear();
});
afterEach(() => {
  cleanup();
});

describe('App DayPanel integration — handleDayPanelSave', () => {
  it('1. clicking Canada classification persists { location: canada } to ac-residence-data', async () => {
    await renderApp();
    await act(async () => { clickDayCell(TEST_DAY); });

    // DayPanel should now be visible; click 'Canada'
    const canadaBtn = await screen.findByRole('button', { name: /Canada/i });
    await act(async () => { fireEvent.click(canadaBtn); });

    const raw = _lsStore.get('ac-residence-data');
    expect(raw).toBeTruthy();
    const entries = JSON.parse(raw);
    const entry = entries.find((e) => e.date === TEST_DATE);
    expect(entry).toBeTruthy();
    expect(entry.location).toBe('canada');
    expect(entry._source).toBe('manual');
  });

  it('2. clicking Mexique + typing note then Fermer persists { location: mexico, notes: hôtel Riu }', async () => {
    await renderApp();
    await act(async () => { clickDayCell(TEST_DAY); });

    const mexiqueBtn = await screen.findByRole('button', { name: /Mexique/i });
    await act(async () => { fireEvent.click(mexiqueBtn); });

    const textarea = screen.getByRole('textbox');
    await act(async () => { fireEvent.change(textarea, { target: { value: 'hôtel Riu' } }); });

    const fermerBtn = screen.getByRole('button', { name: /Fermer/i });
    await act(async () => { fireEvent.click(fermerBtn); });

    const raw = _lsStore.get('ac-residence-data');
    expect(raw).toBeTruthy();
    const entries = JSON.parse(raw);
    const entry = entries.find((e) => e.date === TEST_DATE);
    expect(entry).toBeTruthy();
    expect(entry.location).toBe('mexico');
    expect(entry.notes).toBe('hôtel Riu');
  });

  it('3. note-only (no classification) then Fermer persists { location: null, notes: … }', async () => {
    await renderApp();
    await act(async () => { clickDayCell(TEST_DAY); });

    await screen.findByRole('button', { name: /Canada/i }); // panel open

    const textarea = screen.getByRole('textbox');
    await act(async () => { fireEvent.change(textarea, { target: { value: 'séjour Toronto' } }); });

    const fermerBtn = screen.getByRole('button', { name: /Fermer/i });
    await act(async () => { fireEvent.click(fermerBtn); });

    const raw = _lsStore.get('ac-residence-data');
    expect(raw).toBeTruthy();
    const entries = JSON.parse(raw);
    const entry = entries.find((e) => e.date === TEST_DATE);
    expect(entry).toBeTruthy();
    expect(entry.location).toBe(null);
    expect(entry.notes).toBe('séjour Toronto');
  });

  it('4. seeded entry: Effacer then clear textarea then Fermer removes the entry', async () => {
    // Seed a pre-existing entry for TEST_DATE
    const seed = [{ date: TEST_DATE, location: 'canada', _source: 'manual', _lastModified: '2026-01-15T10:00:00.000Z', _deviceId: 'DEV-TEST' }];
    _lsStore.set('ac-residence-data', JSON.stringify(seed));

    await renderApp();
    await act(async () => { clickDayCell(TEST_DAY); });

    // 'Effacer' button appears only when there is a non-null location
    const effacerBtn = await screen.findByRole('button', { name: /^Effacer$/i });
    await act(async () => { fireEvent.click(effacerBtn); });

    // Clear the notes textarea too (it's empty by default for this seed, but be explicit)
    const textarea = screen.getByRole('textbox');
    await act(async () => { fireEvent.change(textarea, { target: { value: '' } }); });

    const fermerBtn = screen.getByRole('button', { name: /Fermer/i });
    await act(async () => { fireEvent.click(fermerBtn); });

    const raw = _lsStore.get('ac-residence-data');
    // Either null/empty string or an array with no entry for TEST_DATE
    if (raw) {
      const entries = JSON.parse(raw);
      const entry = entries.find((e) => e.date === TEST_DATE);
      expect(entry).toBeUndefined();
    }
  });
});
