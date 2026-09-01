import { describe, it, expect } from 'vitest';
import { residencyProgress } from '../residencyThreshold';

// The 183-day bar is a GOAL meter, not a danger meter: pilots aiming for
// non-residency WANT to cross 183 days outside Canada. Once crossed, the bar
// turns green and the margin flips to a surplus ("+N") instead of a negative.
describe('residencyProgress', () => {
  it('below the threshold: not crossed, plain remaining count, proportional bar', () => {
    expect(residencyProgress(100)).toEqual({ pct: (100 / 183) * 100, crossed: false, margin: '83' });
    expect(residencyProgress(0)).toEqual({ pct: 0, crossed: false, margin: '183' });
  });

  it('at exactly 183: crossed, "+0", full bar', () => {
    expect(residencyProgress(183)).toEqual({ pct: 100, crossed: true, margin: '+0' });
  });

  it('past the threshold: crossed, "+N" surplus, bar capped at 100%', () => {
    expect(residencyProgress(190)).toEqual({ pct: 100, crossed: true, margin: '+7' });
  });

  it('treats non-finite input as 0 (defensive, same H5 family)', () => {
    expect(residencyProgress(NaN)).toEqual({ pct: 0, crossed: false, margin: '183' });
  });
});
