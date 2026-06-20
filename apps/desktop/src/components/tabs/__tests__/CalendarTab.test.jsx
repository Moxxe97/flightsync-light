import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import CalendarTab from '../CalendarTab';

afterEach(cleanup);

const baseProps = {
  residence: [{ date: '2024-02-10', location: 'mexico' }],
  flights: [],
  boardingPassDates: new Set(),
  setDayPanelDate: () => {},
};

describe('CalendarTab year rendering', () => {
  it('renders the given year in the header and all 12 months for a past year', () => {
    render(<CalendarTab {...baseProps} year={2024} />);
    expect(screen.getByText('CALENDRIER FISCAL 2024')).toBeTruthy();
    expect(screen.getByText('Décembre 2024')).toBeTruthy(); // 12th month present
  });

  it('has no Google Calendar import button (GCal integration removed)', () => {
    render(<CalendarTab {...baseProps} />);
    expect(screen.queryByText(/Importer depuis Google Calendar/i)).toBeNull();
  });

  it('renders a note-only day (location null) as untracked but keeps its tooltip', () => {
    render(<CalendarTab {...baseProps} year={2024} residence={[
      { date: '2024-01-10', location: null, notes: 'note sans couleur' },
    ]} />);
    expect(screen.getByTitle('note sans couleur')).toBeTruthy(); // tooltip = the note
    // January card shows 0 tracked days, not 1
    const janCard = screen.getByText('Janvier 2024').closest('.card');
    // The span renders as "0/31 jours" but may be broken into text nodes; use a function matcher
    expect(within(janCard).getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '0/31 jours')).toBeTruthy();
    expect(within(janCard).queryByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '1/31 jours')).toBeNull();
  });
});
