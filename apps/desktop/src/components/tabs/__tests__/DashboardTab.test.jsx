import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('../../../utils/useIsMobile', () => ({ useIsMobile: () => mobile.value }));

import DashboardTab from '../DashboardTab';

afterEach(cleanup);

const flight = { id: 'f1', date: '2026-06-12', flightNumber: 'AC871', departure: 'YUL', arrival: 'DEL', totalTime: 13.3, canadianTime: 4.0, canadianDistance: 612, distance: 3402 };
const baseProps = {
  flights: [flight],
  residence: [],
  totalHours: 13.3, canadianHours: 4.0, canadianTimePct: 30, daysOutside: 0, backupOverdue: false,
  settings: {}, authUser: null,
  saveToGDrive: () => {}, notify: () => {},
  syncToCloud: () => {}, exportToJSON: () => {}, exportToCSV: () => {}, handleImportClick: () => {},
  fiscalYear: {
    year: 2026, canadianTimePct: 30, canadianHours: 4.0, totalHours: 13.3,
    canadianPct: 18, canadianDistance: 612, totalDistance: 3402, flights: [flight],
  },
};

describe('DashboardTab read-only gating', () => {
  it('hides the Actions Rapides row when readOnly but keeps the stats', () => {
    render(<DashboardTab {...baseProps} readOnly />);
    expect(screen.queryByText('ACTIONS RAPIDES')).toBeNull();
    expect(screen.queryByText('Sauvegarder sur Drive')).toBeNull();
    expect(screen.getByText('VOLS ENREGISTRÉS')).toBeTruthy();
  });

  it('shows the Actions Rapides row when not readOnly', () => {
    render(<DashboardTab {...baseProps} />);
    expect(screen.getByText('ACTIONS RAPIDES')).toBeTruthy();
  });
});

describe('DashboardTab residence breakdown', () => {
  // The fiscal breakdown must count residence days by `location`, matching the
  // Calendar — not by the free-form `type` tag, which made the two pages report
  // different "days out of Canada".
  const residence = [
    { date: '2026-01-01', location: 'canada' },
    { date: '2026-01-02', location: 'international', type: 'work' },   // intl by location
    { date: '2026-01-03', location: 'transit', type: 'personal' },    // transit by location
    { date: '2026-01-04', location: 'transit' },                      // transit by location
  ];

  it('shows an International card counted by location', () => {
    render(<DashboardTab {...baseProps} residence={residence} />);
    const card = screen.getByText('🌍 INTERNATIONAL').parentElement;
    expect(within(card).getByText('1')).toBeTruthy();
  });

  it('counts Transit days by location, not by type', () => {
    render(<DashboardTab {...baseProps} residence={residence} />);
    const card = screen.getByText('✈️ TRANSIT').parentElement;
    expect(within(card).getByText('2')).toBeTruthy(); // 2 location==='transit', despite 1 being type 'personal'
  });
});

describe('DashboardTab card 1 — single auth UI contract', () => {
  // The welcome card only shows when flights AND residence are both empty.
  const emptyProps = { ...baseProps, flights: [], residence: [] };

  it('signed-out: shows Backup-tab hint and NO sign-in button', () => {
    render(<DashboardTab {...emptyProps} authUser={null} />);
    expect(screen.getByText('Connectez Google dans l\'onglet Backup')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connecter drive/i })).toBeNull();
  });

  it('signed-in: shows connected state and NO sign-in button', () => {
    const user = { email: 'test@example.com' };
    render(<DashboardTab {...emptyProps} authUser={user} />);
    expect(screen.getByText('Connecté')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connecter drive/i })).toBeNull();
  });
});

describe('DashboardTab fiscal flight row', () => {
  it('renders the distance on desktop as a single-line (row) layout', () => {
    mobile.value = false;
    render(<DashboardTab {...baseProps} />);
    const dist = screen.getByText('3402 nm');               // throws if not rendered
    const row = dist.closest('[data-testid="fiscal-flight-row"]');
    expect(row).not.toBeNull();
    expect(row.style.flexDirection).toBe('row');
  });

  it('stacks the row on mobile so the distance is not pushed off-screen', () => {
    mobile.value = true;
    render(<DashboardTab {...baseProps} />);
    const dist = screen.getByText('3402 nm');
    const row = dist.closest('[data-testid="fiscal-flight-row"]');
    expect(row).not.toBeNull();
    expect(row.style.flexDirection).toBe('column');
  });
});
