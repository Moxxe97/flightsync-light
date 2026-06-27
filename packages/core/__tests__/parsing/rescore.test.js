import { describe, it, expect } from 'vitest';
import { rescoreFlight } from '../../src/parsing/rescore.js';

// A stored flight as it sits in the app after an old import (old polygon values)
const stored = {
  id: 'pdf-AC0845-2026-06-12-0',
  date: '2026-06-12',
  flightNumber: 'AC0845',
  departure: 'EGPH',
  arrival: 'YUL',
  totalTime: 6.5,
  canadianTime: 2.31,
  distance: 2626,
  canadianDistance: 934,
  notes: 'PDF OFP — 934/2626 nm (35.6% canadien) [waypoints (42 fixes)]',
  _deviceId: 'mac-1',
};

// The same leg as parseOfp returns it after re-parsing the stored OFP
// with the corrected polygon
const reparsed = {
  id: 'pdf-AC0845-2026-06-12-0',
  date: '2026-06-12',
  flightNumber: 'AC0845',
  departure: 'EGPH',
  arrival: 'YUL',
  totalTime: 6.5,
  canadianTime: 2.02,
  distance: 2626,
  canadianDistance: 816,
  notes: 'PDF OFP — 816/2626 nm (31.1% canadien) [waypoints (42 fixes)]',
  _confidence: 100,
};

describe('rescoreFlight', () => {
  it('refreshes geo-derived fields from the re-parse and preserves identity fields', () => {
    const { flight, changed } = rescoreFlight(stored, [reparsed]);
    expect(changed).toBe(true);
    expect(flight.canadianDistance).toBe(816);
    expect(flight.canadianTime).toBe(2.02);
    expect(flight.distance).toBe(2626);
    expect(flight.id).toBe(stored.id);
    expect(flight.departure).toBe('EGPH');
    expect(flight.arrival).toBe('YUL');
    expect(flight._deviceId).toBe('mac-1');
  });

  it('scales canadianTime to a user-edited totalTime instead of the parsed one', () => {
    const edited = { ...stored, totalTime: 7.0 }; // user corrected block time
    const { flight } = rescoreFlight(edited, [reparsed]);
    expect(flight.totalTime).toBe(7.0);
    // 7.0 × (2.02 / 6.5) = 2.18
    expect(flight.canadianTime).toBeCloseTo(2.18, 2);
  });

  it('matches the right leg in a multi-leg parse by date + flight number', () => {
    const otherLeg = { ...reparsed, flightNumber: 'AC0846', canadianDistance: 40 };
    const { flight } = rescoreFlight(stored, [otherLeg, reparsed]);
    expect(flight.canadianDistance).toBe(816);
  });

  it('returns null when no parsed leg matches', () => {
    expect(rescoreFlight(stored, [{ ...reparsed, date: '2026-06-13' }])).toBe(null);
    expect(rescoreFlight(stored, [])).toBe(null);
  });

  it('replaces auto-generated notes but keeps custom notes', () => {
    const auto = rescoreFlight(stored, [reparsed]);
    expect(auto.flight.notes).toBe(reparsed.notes);

    const custom = rescoreFlight({ ...stored, notes: 'déroutement météo' }, [reparsed]);
    expect(custom.flight.notes).toBe('déroutement météo');
  });

  it('reports changed: false when the re-parse yields identical numbers', () => {
    const same = { ...reparsed, canadianDistance: 934, canadianTime: 2.31 };
    const { changed } = rescoreFlight(stored, [same]);
    expect(changed).toBe(false);
  });

  it('falls back to the distance ratio when the parsed totalTime is 0', () => {
    const noTime = { ...reparsed, totalTime: 0, canadianTime: 0 };
    const { flight } = rescoreFlight(stored, [noTime]);
    // 6.5 × (816 / 2626) = 2.02
    expect(flight.canadianTime).toBeCloseTo(2.02, 2);
  });
});
