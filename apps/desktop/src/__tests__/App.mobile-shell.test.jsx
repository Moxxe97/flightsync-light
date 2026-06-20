// Integration test for the responsive shell wiring in App.jsx (Task 6).
//
// App.jsx is ~1400 lines and the individual hooks/components are unit-tested
// elsewhere. What is NOT covered there is the *branching* in App.jsx itself:
//   - isMobile=true + section=null  -> renders the MobileHomeMenu (no desktop tabs)
//   - clicking a menu row           -> calls mobileNav.open(id) (drill-in)
//   - isMobile=true + section set   -> renders MobileSectionHeader + that section
//   - isMobile=false                -> renders the desktop tab bar, never the mobile shell
//
// We mock the heavy auth/idb/calendar dependencies so the app tree renders,
// and we mock the two mobile hooks so the test can drive the branch.
// MobileHomeMenu / MobileSectionHeader are the REAL components — this verifies
// the actual wiring, not test doubles.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// This jsdom instance ships without a usable localStorage; App reads/writes it
// during startup. Install a minimal in-memory polyfill before App is imported.
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

// ─── Mutable controls for the mocked mobile hooks ───
let mobileState = { isMobile: false, section: null };
const openSpy = vi.fn();
const backSpy = vi.fn();

vi.mock('../utils/useIsMobile', () => ({
  useIsMobile: () => mobileState.isMobile,
}));
vi.mock('../utils/useMobileNav', () => ({
  useMobileNav: () => ({ section: mobileState.section, open: openSpy, back: backSpy }),
}));

// ─── Auth: the app renders for everyone; provide a signed-in profile ───
vi.mock('../utils/cloudAuth', () => ({
  onAuthChanged: (cb) => { cb({ uid: 'test-user' }); return () => {}; },
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}));

// ─── Side-effecting modules used by startup effects ───
vi.mock('@flightsync/core/idb', () => ({
  getAllBoardingPassDates: async () => [],
  getAllOFPFlightIds: async () => [],
  getAllBoardingPassInfo: async () => [],
  getAllArchiveYears: async () => [],
}));
vi.mock('../utils/icsExport', () => ({
  exportICS: vi.fn(),
}));
vi.mock('../utils/driveBackup', () => ({
  runBackup: vi.fn(async () => {}),
  findBackup: vi.fn(async () => null),
  downloadBackup: vi.fn(async () => ''),
  restoreBlobs: vi.fn(async () => ({ ofps: 0, boardingPasses: 0 })),
}));

// ─── Stub the tab bodies so we can identify the rendered section cheaply ───
vi.mock('../components/tabs/DashboardTab', () => ({ default: () => <div data-testid="tab-dashboard" /> }));
vi.mock('../components/tabs/CalendarTab', () => ({ default: () => <div data-testid="tab-calendar" /> }));
vi.mock('../components/tabs/BackupTab', () => ({ default: () => <div data-testid="tab-backup" /> }));
vi.mock('../components/tabs/DataTab', () => ({ default: () => <div data-testid="tab-data" /> }));
vi.mock('../components/tabs/ArchiveTab', () => ({ default: () => <div data-testid="tab-archive" /> }));
vi.mock('../components/tabs/HistoryTab', () => ({ default: () => <div data-testid="tab-history" /> }));

import App from '../App.jsx';

// App's init effect reads device id / data from localStorage via async helpers;
// flushing the microtask queue lets isLoading settle to false before we assert.
async function renderApp() {
  const utils = render(<App />);
  // Let the queued auth callback + init effect resolve.
  await screen.findByText('Flight Sync System');
  return utils;
}

describe('App responsive shell wiring', () => {
  beforeEach(() => {
    mobileState = { isMobile: false, section: null };
    openSpy.mockClear();
    backSpy.mockClear();
  });
  afterEach(() => cleanup());

  it('desktop (isMobile=false): renders the tab bar, not the mobile shell', async () => {
    mobileState = { isMobile: false, section: null };
    await renderApp();

    // Desktop tab bar present (one tab-btn per section).
    const tabButtons = document.querySelectorAll('.tab-btn');
    expect(tabButtons.length).toBe(6);
    // Default section content is the dashboard.
    expect(screen.getByTestId('tab-dashboard')).toBeDefined();
    // Mobile shell never rendered.
    expect(document.querySelector('.mobile-menu')).toBeNull();
    expect(document.querySelector('.mobile-section-header')).toBeNull();
  });

  it('mobile home (isMobile=true, section=null): renders MobileHomeMenu, not the desktop tabs', async () => {
    mobileState = { isMobile: true, section: null };
    await renderApp();

    // The real MobileHomeMenu renders one button per section.
    const menu = document.querySelector('.mobile-menu');
    expect(menu).not.toBeNull();
    expect(menu.querySelectorAll('.mobile-menu-item').length).toBe(6);
    // Desktop tab bar and section content are absent on the home screen.
    expect(document.querySelector('.tab-btn')).toBeNull();
    expect(screen.queryByTestId('tab-dashboard')).toBeNull();
    expect(document.querySelector('.mobile-section-header')).toBeNull();
  });

  it('mobile home: clicking a menu row drills into that section via mobileNav.open', async () => {
    mobileState = { isMobile: true, section: null };
    await renderApp();

    fireEvent.click(screen.getByText('Calendrier'));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('calendar');
  });

  it('mobile section (isMobile=true, section set): renders MobileSectionHeader + that section', async () => {
    mobileState = { isMobile: true, section: 'backup' };
    await renderApp();

    // Section header with the section's label and a back control.
    expect(document.querySelector('.mobile-section-header')).not.toBeNull();
    expect(screen.getByText('Backup & Restore')).toBeDefined();
    expect(screen.getByRole('button', { name: /retour/i })).toBeDefined();
    // The matching section body renders; the home menu does not.
    expect(screen.getByTestId('tab-backup')).toBeDefined();
    expect(document.querySelector('.mobile-menu')).toBeNull();
    // Other sections are not rendered.
    expect(screen.queryByTestId('tab-dashboard')).toBeNull();
  });

  it('mobile section: the back control calls mobileNav.back', async () => {
    mobileState = { isMobile: true, section: 'calendar' };
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: /retour/i }));
    expect(backSpy).toHaveBeenCalledTimes(1);
  });
});
