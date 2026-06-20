import { describe, it, expect } from 'vitest';
import { computeAllTimeSummary, computeFiscalYear } from '../../src/tax/canadian-proportion.js';
import { PROVINCES, getResidenceRule } from '../../src/tax/residence-rules.js';

// ─── Residence Rules ─────────────────────────────────────────────────────────

describe('residence rules', () => {
  it('returns a rule for a valid province', () => {
    expect(getResidenceRule(PROVINCES.QC)).toEqual({ province: 'QC', basis: 'time' });
  });

  it('returns the same time-based rule for all provinces', () => {
    for (const prov of Object.values(PROVINCES)) {
      expect(getResidenceRule(prov)).toEqual({ province: prov, basis: 'time' });
    }
  });

  it('throws for an unknown province', () => {
    expect(() => getResidenceRule('XX')).toThrow(/Unknown province/);
  });

  it('throws for an empty string', () => {
    expect(() => getResidenceRule('')).toThrow(/Unknown province/);
  });
});

// ─── computeAllTimeSummary ────────────────────────────────────────────────────

describe('computeAllTimeSummary (synthetic)', () => {
  it('returns zero summary when there are no flights', () => {
    const result = computeAllTimeSummary([]);
    expect(result).toEqual({ totalHours: 0, canadianHours: 0, canadianTimePct: 0 });
  });

  it('computes correct totals for a single flight', () => {
    const flights = [{ totalTime: 8.0, canadianTime: 2.0 }];
    const result = computeAllTimeSummary(flights);
    expect(result.totalHours).toBe(8.0);
    expect(result.canadianHours).toBe(2.0);
    expect(result.canadianTimePct).toBe('25.0');
  });

  it('accumulates hours across multiple flights', () => {
    const flights = [
      { totalTime: 8.0, canadianTime: 2.0 },
      { totalTime: 4.0, canadianTime: 1.0 },
    ];
    const result = computeAllTimeSummary(flights);
    expect(result.totalHours).toBe(12.0);
    expect(result.canadianHours).toBe(3.0);
    expect(result.canadianTimePct).toBe('25.0');
  });

  it('handles missing totalTime/canadianTime fields gracefully (treats as 0)', () => {
    const flights = [{ totalTime: 5.0 }, { canadianTime: 1.0 }, {}];
    const result = computeAllTimeSummary(flights);
    expect(result.totalHours).toBe(5.0);
    expect(result.canadianHours).toBe(1.0);
    expect(result.canadianTimePct).toBe('20.0');
  });

  it('returns canadianTimePct=0 (not NaN) when totalHours is 0', () => {
    const result = computeAllTimeSummary([{ totalTime: 0, canadianTime: 0 }]);
    expect(result.canadianTimePct).toBe(0);
  });
});

// ─── computeFiscalYear ───────────────────────────────────────────────────────

describe('computeFiscalYear (synthetic)', () => {
  it('returns empty year object when there are no flights', () => {
    const result = computeFiscalYear([], 2025);
    expect(result).toEqual({
      year: 2025,
      flights: [],
      totalHours: 0,
      canadianHours: 0,
      totalDistance: 0,
      canadianDistance: 0,
      canadianTimePct: 0,
      canadianPct: 0,
    });
  });

  it('filters to the requested year only', () => {
    const flights = [
      { date: '2024-11-15', totalTime: 8.0, canadianTime: 2.0, distance: 1000, canadianDistance: 100 },
      { date: '2025-03-10', totalTime: 7.0, canadianTime: 3.5, distance: 900, canadianDistance: 200 },
      { date: '2025-07-22', totalTime: 6.0, canadianTime: 1.0, distance: 800, canadianDistance: 50 },
    ];
    const result = computeFiscalYear(flights, 2025);
    expect(result.year).toBe(2025);
    expect(result.flights).toHaveLength(2);
    expect(result.totalHours).toBe(13.0);
    expect(result.canadianHours).toBe(4.5);
    expect(result.totalDistance).toBe(1700);
    expect(result.canadianDistance).toBe(250);
  });

  it('computes canadianTimePct correctly (time-based per ARC)', () => {
    const flights = [
      { date: '2025-01-10', totalTime: 10.0, canadianTime: 4.0, distance: 1000, canadianDistance: 300 },
    ];
    const result = computeFiscalYear(flights, 2025);
    // 4/10 = 40.0% time-based
    expect(result.canadianTimePct).toBe('40.0');
    // 300/1000 = 30.0% distance-based (informational only)
    expect(result.canadianPct).toBe('30.0');
  });

  it('returns zero pcts when sums are zero', () => {
    const flights = [
      { date: '2025-05-01', totalTime: 0, canadianTime: 0, distance: 0, canadianDistance: 0 },
    ];
    const result = computeFiscalYear(flights, 2025);
    expect(result.canadianTimePct).toBe(0);
    expect(result.canadianPct).toBe(0);
  });

  it('accepts a province argument without affecting output (reserved for future)', () => {
    const flights = [
      { date: '2025-06-15', totalTime: 8.0, canadianTime: 2.0, distance: 1000, canadianDistance: 100 },
    ];
    const withProvince = computeFiscalYear(flights, 2025, PROVINCES.QC);
    const withoutProvince = computeFiscalYear(flights, 2025);
    // Province argument is reserved for future per-province logic; output must be identical for now.
    expect(withProvince).toEqual(withoutProvince);
  });

  it('throws when an invalid province is passed', () => {
    const flights = [];
    expect(() => computeFiscalYear(flights, 2025, 'XX')).toThrow(/Unknown province/);
  });
});
