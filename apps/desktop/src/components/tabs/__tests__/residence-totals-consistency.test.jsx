import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../../../utils/useIsMobile', () => ({ useIsMobile: () => false }));

import DashboardTab from '../DashboardTab';
import CalendarTab from '../CalendarTab';

afterEach(cleanup);

// Pull the "Jours hors Canada : N / 183" number out of a rendered tab.
function outsideShown(container) {
  const m = container.textContent.match(/Jours hors Canada\s*:\s*(\d+)\s*\/\s*183/);
  return m ? Number(m[1]) : null;
}

const flight = { id: 'f1', date: '2026-06-12', flightNumber: 'AC871', departure: 'YUL', arrival: 'DEL', totalTime: 13.3, canadianTime: 4.0, canadianDistance: 612, distance: 3402 };
const dashProps = {
  flights: [flight], totalHours: 13.3, canadianHours: 4.0, canadianTimePct: 30,
  daysOutside: 0, backupOverdue: false, settings: {}, authUser: null,
  saveToGDrive: () => {}, notify: () => {},
  syncToCloud: () => {}, exportToJSON: () => {}, exportToCSV: () => {}, handleImportClick: () => {},
  fiscalYear: { year: 2026, canadianTimePct: 30, canadianHours: 4.0, totalHours: 13.3, canadianPct: 18, canadianDistance: 612, totalDistance: 3402, flights: [flight] },
};
const calProps = {
  flights: [], boardingPassDates: new Set(),
  setDayPanelDate: () => {}, year: 2026,
};

describe('Tableau de bord and Calendrier agree on days out of Canada', () => {
  it('reports the same total for clean four-location data', () => {
    const residence = [
      { date: '2026-01-01', location: 'canada' },
      { date: '2026-01-02', location: 'mexico' },
      { date: '2026-01-03', location: 'international' },
      { date: '2026-01-04', location: 'transit' },
    ];
    const dash = render(<DashboardTab {...dashProps} residence={residence} />);
    const cal = render(<CalendarTab {...calProps} residence={residence} />);
    expect(outsideShown(dash.container)).toBe(3);
    expect(outsideShown(cal.container)).toBe(outsideShown(dash.container));
  });

  it('still agrees when a day has an unknown/off-list location', () => {
    // Previously the Dashboard counted this (location !== "canada") while the
    // Calendar's allow-list (mexico+international+transit) silently dropped it,
    // so the two pages disagreed.
    const residence = [
      { date: '2026-01-01', location: 'canada' },
      { date: '2026-01-02', location: 'mexico' },
      { date: '2026-01-03', location: 'usa' },
    ];
    const dash = render(<DashboardTab {...dashProps} residence={residence} />);
    const cal = render(<CalendarTab {...calProps} residence={residence} />);
    expect(outsideShown(dash.container)).toBe(outsideShown(cal.container));
  });
});
