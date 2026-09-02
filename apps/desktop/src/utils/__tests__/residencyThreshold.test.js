import { describe, it, expect } from 'vitest';
import { residencyProgress, residencyThresholdDays } from '../residencyThreshold';

// The 183-day bar is a GOAL meter, not a danger meter: pilots aiming for
// non-residency WANT to cross 183 days outside Canada. Once crossed, the bar
// turns green and the margin flips to a surplus ("+N") instead of a negative.
describe('residencyProgress', () => {
  it('below the threshold: not crossed, plain remaining count, proportional bar', () => {
    expect(residencyProgress(100, 2026)).toEqual({ pct: (100 / 183) * 100, crossed: false, margin: '83', threshold: 183 });
    expect(residencyProgress(0, 2026)).toEqual({ pct: 0, crossed: false, margin: '183', threshold: 183 });
  });

  it('at exactly 183: crossed, "+0", full bar', () => {
    expect(residencyProgress(183, 2026)).toEqual({ pct: 100, crossed: true, margin: '+0', threshold: 183 });
  });

  it('past the threshold: crossed, "+N" surplus, bar capped at 100%', () => {
    expect(residencyProgress(190, 2026)).toEqual({ pct: 100, crossed: true, margin: '+7', threshold: 183 });
  });

  it('treats non-finite input as 0 (defensive, same H5 family)', () => {
    expect(residencyProgress(NaN, 2026)).toEqual({ pct: 0, crossed: false, margin: '183', threshold: 183 });
  });
});

// The CRA sojourner rule deems someone resident at 183+ days IN Canada, so the
// days-outside goal is "everything but 182 days": 183 in a 365-day year and 184
// in a leap year. A fixed 183 celebrated "+0" in 2028 while 183 days remained
// in Canada — exactly the deemed-resident count.
describe('residencyThresholdDays', () => {
  it('is 183 in a common year and 184 in a leap year', () => {
    expect(residencyThresholdDays(2026)).toBe(183);
    expect(residencyThresholdDays(2027)).toBe(183);
    expect(residencyThresholdDays(2028)).toBe(184);
    expect(residencyThresholdDays(2032)).toBe(184);
    expect(residencyThresholdDays(2100)).toBe(183); // century rule
  });

  it('accepts the year as a string (archive years are strings)', () => {
    expect(residencyThresholdDays('2028')).toBe(184);
  });
});

describe('residencyProgress in a leap year', () => {
  it('does not celebrate at 183 outside in 2028 (183 days still in Canada)', () => {
    expect(residencyProgress(183, 2028)).toEqual({ pct: (183 / 184) * 100, crossed: false, margin: '1', threshold: 184 });
  });

  it('crosses at 184 outside in 2028', () => {
    expect(residencyProgress(184, 2028)).toEqual({ pct: 100, crossed: true, margin: '+0', threshold: 184 });
  });

  it('keeps 183 as the goal in a common year and reports it', () => {
    expect(residencyProgress(183, 2027)).toMatchObject({ crossed: true, margin: '+0', threshold: 183 });
  });
});
