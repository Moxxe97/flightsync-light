import { describe, it, expect } from 'vitest';
import { tallyResidence } from '../residence';

describe('tallyResidence — single source of truth for day counts', () => {
  it('buckets days by location and reports outside = total - canada', () => {
    const residence = [
      { date: '2026-01-01', location: 'canada' },
      { date: '2026-01-02', location: 'canada' },
      { date: '2026-01-03', location: 'mexico' },
      { date: '2026-01-04', location: 'international' },
      { date: '2026-01-05', location: 'transit' },
    ];
    const t = tallyResidence(residence);
    expect(t).toMatchObject({ canada: 2, mexico: 1, international: 1, transit: 1, other: 0 });
    expect(t.total).toBe(5);
    expect(t.outside).toBe(3);
  });

  it('counts by location, never by the free-form type tag', () => {
    const t = tallyResidence([
      { date: '2026-01-01', location: 'canada', type: 'mexico' },
      { date: '2026-01-02', location: 'mexico', type: 'work' },
    ]);
    expect(t.canada).toBe(1);
    expect(t.mexico).toBe(1);
  });

  it('still counts unknown non-null locations as days outside Canada', () => {
    const t = tallyResidence([
      { date: '2026-01-01', location: 'canada' },
      { date: '2026-01-02', location: 'usa' },
    ]);
    expect(t.other).toBe(1);
    expect(t.total).toBe(2);
    expect(t.outside).toBe(1);
  });

  it('excludes note-only days (location == null) from every count', () => {
    const t = tallyResidence([
      { date: '2026-01-01', location: 'canada' },
      { date: '2026-01-02', location: null, notes: 'remarque sans classification' },
      { date: '2026-01-03', notes: 'pas de location du tout' },
    ]);
    expect(t.canada).toBe(1);
    expect(t.total).toBe(1);   // note-only days are untracked
    expect(t.outside).toBe(0); // and must never count as days away
  });

  it('handles empty and undefined input', () => {
    expect(tallyResidence([]).total).toBe(0);
    expect(tallyResidence(undefined).total).toBe(0);
    expect(tallyResidence(undefined).outside).toBe(0);
  });
});
