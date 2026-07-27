import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import DataTab from '../DataTab';

afterEach(cleanup);

const flight = { id: 'f1', date: '2025-06-12', flightNumber: 'AC871', departure: 'YUL', arrival: 'DEL', totalTime: 13.3, canadianTime: 4, canadianDistance: 600, distance: 3400 };
const baseProps = {
  flights: [flight],
  residence: [],
  ofpFlightIds: new Set(['f1']),
  setOfpModalFlightId: () => {},
  setDeleteConfirm: () => {},
  handlePdfImport: () => {},
  notify: () => {},
  deviceId: 'DEV',
};

describe('DataTab read-only gating', () => {
  it('hides PDF import and delete, keeps the OFP viewer button, when readOnly', () => {
    render(<DataTab {...baseProps} readOnly />);
    expect(screen.queryByText(/PDF IMPORT/i)).toBeNull();
    expect(screen.queryByTitle('Delete this flight')).toBeNull();
    expect(screen.getByTitle('View flight plan')).toBeTruthy();
  });

  it('shows PDF import and delete when not readOnly', () => {
    render(<DataTab {...baseProps} />);
    expect(screen.getByText(/PDF IMPORT/i)).toBeTruthy();
    expect(screen.getByTitle('Delete this flight')).toBeTruthy();
  });

  it('does not mutate the flights prop when sorting (audit #29)', () => {
    const flights = [
      { ...flight, id: 'f2', date: '2025-01-01' },
      { ...flight, id: 'f1', date: '2025-06-12' },
    ];
    const original = [...flights];
    render(<DataTab {...baseProps} flights={flights} />);
    expect(flights).toEqual(original);
  });
});
