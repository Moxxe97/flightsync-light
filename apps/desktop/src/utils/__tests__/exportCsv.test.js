import { describe, it, expect } from 'vitest';
import { buildFlightsCsv, looksLikeFlightRow } from '../exportCsv';

const HEADERS = ['Date', 'Flight', 'Departure', 'Arrival', 'Canada Time (h)', 'Total Time (h)', '% Canada'];

const flight = (over = {}) => ({
  date: '2026-08-02', flightNumber: 'AC0876', departure: 'YUL', arrival: 'LYS',
  totalTime: 7.3, canadianTime: 1.6, distance: 3520, canadianDistance: 714, notes: 'x',
  ...over,
});

describe('buildFlightsCsv', () => {
  it('emits header, one row per flight sorted by date, and a final TOTAL row', () => {
    const csv = buildFlightsCsv([
      flight({ date: '2026-08-04', flightNumber: 'AC0877', departure: 'LYS', arrival: 'YUL', totalTime: 8.1, canadianTime: 1.8 }),
      flight(),
    ], HEADERS);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(HEADERS.join(','));
    expect(lines[1]).toBe('2026-08-02,AC0876,YUL,LYS,1.6,7.3,21.9');
    expect(lines[2]).toBe('2026-08-04,AC0877,LYS,YUL,1.8,8.1,22.2');
    expect(lines[3].startsWith('TOTAL,,,,')).toBe(true);
  });

  it('per-flight % is time-based, not distance-based', () => {
    // distance ratio would be 714/3520 = 20.3 — time ratio is 1.6/7.3 = 21.9
    const csv = buildFlightsCsv([flight()], HEADERS);
    expect(csv.split('\n')[1].endsWith(',21.9')).toBe(true);
  });

  it('TOTAL row carries 1-decimal sums and the true aggregate %, not the average of row %s', () => {
    // 1/10 = 10% and 9/10 = 90% → average of rows 50%, true aggregate 10/20 = 50?
    // use asymmetric times so the two differ: 1/2 (50%) + 1/8 (12.5%) → avg 31.25, aggregate 2/10 = 20.0
    const csv = buildFlightsCsv([
      flight({ date: '2026-01-01', totalTime: 2, canadianTime: 1 }),
      flight({ date: '2026-01-02', totalTime: 8, canadianTime: 1 }),
    ], HEADERS);
    const total = csv.split('\n')[3];
    expect(total).toBe('TOTAL,,,,2.0,10.0,20.0');
  });

  it('a flight with zero total time exports 0 percent', () => {
    const csv = buildFlightsCsv([flight({ totalTime: 0, canadianTime: 0 })], HEADERS);
    expect(csv.split('\n')[1]).toBe('2026-08-02,AC0876,YUL,LYS,0,0,0');
  });

  it('treats non-finite stored values as 0 in rows and totals', () => {
    const csv = buildFlightsCsv([
      flight({ totalTime: NaN, canadianTime: NaN }),
      flight({ date: '2026-08-04', totalTime: 4, canadianTime: 2 }),
    ], HEADERS);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('2026-08-02,AC0876,YUL,LYS,0,0,0');
    expect(lines[3]).toBe('TOTAL,,,,2.0,4.0,50.0');
  });

  it('escapes fields containing commas or quotes', () => {
    const csv = buildFlightsCsv([flight({ flightNumber: 'AC "12",3' })], HEADERS);
    expect(csv.split('\n')[1]).toContain('"AC ""12"",3"');
  });
});

describe('looksLikeFlightRow', () => {
  it('keeps ISO and non-ISO dates', () => {
    expect(looksLikeFlightRow('2026-08-02')).toBe(true);
    expect(looksLikeFlightRow('02/08/2026')).toBe(true);
  });
  it('skips the TOTAL line and digit-less footers', () => {
    expect(looksLikeFlightRow('TOTAL')).toBe(false);
    expect(looksLikeFlightRow('Total')).toBe(false);
    expect(looksLikeFlightRow('end of report')).toBe(false);
    expect(looksLikeFlightRow('')).toBe(false);
  });
});
