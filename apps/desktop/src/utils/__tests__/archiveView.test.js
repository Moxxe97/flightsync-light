import { describe, it, expect } from 'vitest';
import { selectDisplayData, archiveYearList, adjacentYear } from '../archiveView';

const archiveYears = [
  { year: '2025', flights: [{ id: 'a' }], residence: [{ date: '2025-01-01', location: 'canada' }] },
  { year: '2024', flights: [{ id: 'b' }], residence: [] },
];

describe('selectDisplayData', () => {
  it('returns live data and readOnly=false when viewYear is null', () => {
    const live = { viewYear: null, flights: [{ id: 'live' }], residence: [{ date: '2026-01-01' }], archiveYears };
    const r = selectDisplayData(live);
    expect(r.flights).toEqual([{ id: 'live' }]);
    expect(r.residence).toEqual([{ date: '2026-01-01' }]);
    expect(r.readOnly).toBe(false);
    expect(r.year).toBeNull();
  });

  it('returns the archived year data and readOnly=true when viewYear is set', () => {
    const r = selectDisplayData({ viewYear: '2025', flights: [{ id: 'live' }], residence: [], archiveYears });
    expect(r.flights).toEqual([{ id: 'a' }]);
    expect(r.residence).toEqual([{ date: '2025-01-01', location: 'canada' }]);
    expect(r.readOnly).toBe(true);
    expect(r.year).toBe('2025');
  });

  it('returns empty arrays (still read-only) when the year is missing', () => {
    const r = selectDisplayData({ viewYear: '2099', flights: [{ id: 'live' }], residence: [], archiveYears });
    expect(r.flights).toEqual([]);
    expect(r.residence).toEqual([]);
    expect(r.readOnly).toBe(true);
  });
});

describe('archiveYearList', () => {
  it('returns years newest-first as strings, dropping falsy', () => {
    expect(archiveYearList(archiveYears)).toEqual(['2025', '2024']);
    expect(archiveYearList([{ year: '2023' }, { year: null }, { year: '2024' }])).toEqual(['2024', '2023']);
    expect(archiveYearList(undefined)).toEqual([]);
  });
});

describe('adjacentYear', () => {
  const years = ['2025', '2024', '2023'];
  it('returns the older year for dir -1', () => {
    expect(adjacentYear(years, '2024', -1)).toBe('2023');
  });
  it('returns the newer year for dir +1', () => {
    expect(adjacentYear(years, '2024', +1)).toBe('2025');
  });
  it('returns null at the ends', () => {
    expect(adjacentYear(years, '2023', -1)).toBeNull();
    expect(adjacentYear(years, '2025', +1)).toBeNull();
  });
  it('returns null when current is not in the list', () => {
    expect(adjacentYear(years, '2099', -1)).toBeNull();
  });
});
