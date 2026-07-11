import { describe, it, expect } from 'vitest';
import { normalizeFlightAirports } from '../../src/parsing/normalize-airports.js';
import { estimateRoute } from '../../src/geo/route-average.js';

describe('normalizeFlightAirports', () => {
  const stamp = { timestamp: 1780000000000, deviceId: 'test-device' };

  it('rewrites ICAO departure/arrival to IATA and stamps sync metadata', () => {
    const input = [
      { id: 'a', date: '2026-06-03', flightNumber: 'AC0882', departure: 'YUL', arrival: 'LIRN', _lastModified: 1 },
      { id: 'b', date: '2026-06-09', flightNumber: 'AC0936', departure: 'YUL', arrival: 'EGPH', _lastModified: 1 },
    ];
    const { flights, changed } = normalizeFlightAirports(input, stamp);
    expect(flights.map(f => f.arrival)).toEqual(['NAP', 'EDI']);
    expect(changed).toHaveLength(2);
    expect(changed[0]._lastModified).toBe(stamp.timestamp);
    expect(changed[0]._deviceId).toBe('test-device');
  });

  it('is idempotent: already-IATA rows pass through by reference, changed=[]', () => {
    const input = [
      { id: 'a', departure: 'YUL', arrival: 'NAP', _lastModified: 1 },
      { id: 'b', departure: 'DUB', arrival: 'YUL', _lastModified: 1 },
    ];
    const { flights, changed } = normalizeFlightAirports(input, stamp);
    expect(changed).toEqual([]);
    expect(flights[0]).toBe(input[0]);
    expect(flights[1]).toBe(input[1]);
    expect(flights[0]._lastModified).toBe(1);
  });

  it('leaves unknown codes untouched rather than guessing', () => {
    const input = [{ id: 'a', departure: 'YUL', arrival: 'ZZZZ' }];
    const { changed } = normalizeFlightAirports(input, stamp);
    expect(changed).toEqual([]);
  });

  it('leaves null/missing/empty codes untouched (no "" coercion)', () => {
    const input = [
      { id: 'a', departure: null, arrival: 'YUL' },
      { id: 'b', arrival: 'YUL' },
      { id: 'c', departure: '', arrival: 'YUL' },
    ];
    const { flights, changed } = normalizeFlightAirports(input, stamp);
    expect(changed).toEqual([]);
    expect(flights[0].departure).toBeNull();
    expect(flights[1].departure).toBeUndefined();
    expect(flights[2].departure).toBe('');
  });

  it('does not touch _lastModified when no stamp options are given', () => {
    const input = [{ id: 'a', departure: 'YUL', arrival: 'EIDW', _lastModified: 42 }];
    const { changed } = normalizeFlightAirports(input);
    expect(changed[0].arrival).toBe('DUB');
    expect(changed[0]._lastModified).toBe(42);
  });

  it('does not mutate its input', () => {
    const input = [{ id: 'a', departure: 'YUL', arrival: 'EIDW' }];
    normalizeFlightAirports(input, stamp);
    expect(input[0].arrival).toBe('EIDW');
  });
});

describe('estimateRoute with mixed ICAO/IATA history', () => {
  it('finds history stored under ICAO when queried with IATA (summary side)', () => {
    const stored = [
      { departure: 'YUL', arrival: 'EIDW', distance: 2577, canadianDistance: 686 },
      { departure: 'YUL', arrival: 'EIDW', distance: 2577, canadianDistance: 690 },
    ];
    const est = estimateRoute('YUL', 'DUB', stored);
    expect(est.source).toBe('history-avg');
    expect(est.distance).toBe(2577);
    expect(est.canadianDistance).toBe(688);
  });

  it('falls back to great-circle with coords for newly-added airports', () => {
    const est = estimateRoute('YUL', 'NAP', []);
    expect(est.source).toBe('great-circle');
    // Real dispatch G/C for YUL–NAP is 3665 nm; coords must land within 1%.
    expect(est.distance).toBeGreaterThan(3628);
    expect(est.distance).toBeLessThan(3702);
  });

  it('accepts an ICAO query too (defensive: caller passes stored codes)', () => {
    const stored = [{ departure: 'YUL', arrival: 'NAP', distance: 3665, canadianDistance: 850 }];
    const est = estimateRoute('CYUL', 'LIRN', stored);
    expect(est.source).toBe('history-avg');
  });
});
