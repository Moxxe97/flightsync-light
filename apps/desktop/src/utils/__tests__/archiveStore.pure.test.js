import { describe, it, expect } from 'vitest';
import { parseArchiveKey, buildManifest, mergeYearData, ARCHIVE_SCHEMA } from '../archiveStore';

describe('parseArchiveKey', () => {
  it('parses flights and residence archive keys', () => {
    expect(parseArchiveKey('ac-flights-archive-2025')).toEqual({ kind: 'flights', year: '2025' });
    expect(parseArchiveKey('ac-residence-archive-2024')).toEqual({ kind: 'residence', year: '2024' });
  });
  it('returns null for non-archive keys', () => {
    expect(parseArchiveKey('ac-flights-data')).toBeNull();
    expect(parseArchiveKey('ac-flights-archive-20')).toBeNull();
    expect(parseArchiveKey(null)).toBeNull();
    expect(parseArchiveKey(42)).toBeNull();
  });
});

describe('buildManifest', () => {
  it('summarizes a year and keeps only that year/owned ids', () => {
    const flights = [
      { id: 'f1', date: '2025-03-02' },
      { id: 'f2', date: '2025-11-20' },
    ];
    const residence = [{ date: '2025-03-02' }, { date: '2025-03-03' }];
    const m = buildManifest({
      year: '2025', flights, residence,
      ofpFlightIds: ['f1', 'fX'],
      bpDates: ['2025-03-02', '2024-12-31'],
    });
    expect(m.schema).toBe(ARCHIVE_SCHEMA);
    expect(m.flightCount).toBe(2);
    expect(m.residenceDays).toBe(2);
    expect(m.dateRange).toEqual({ from: '2025-03-02', to: '2025-11-20' });
    expect(m.ofpFlightIds).toEqual(['f1']);
    expect(m.bpDates).toEqual(['2025-03-02']);
  });
  it('handles an empty year', () => {
    const m = buildManifest({ year: '2025', flights: [], residence: [] });
    expect(m.flightCount).toBe(0);
    expect(m.dateRange).toBeNull();
    expect(m.ofpFlightIds).toEqual([]);
    expect(m.bpDates).toEqual([]);
  });
});

describe('mergeYearData', () => {
  it('dedupes flights by id and residence by date, existing wins', () => {
    const existing = { flights: [{ id: 'f1', date: '2025-01-01', v: 'old' }], residence: [{ date: '2025-01-01', location: 'canada' }] };
    const incoming = { flights: [{ id: 'f1', date: '2025-01-01', v: 'new' }, { id: 'f2', date: '2025-02-02' }], residence: [{ date: '2025-01-01', location: 'mexico' }, { date: '2025-02-02', location: 'transit' }] };
    const out = mergeYearData(existing, incoming);
    expect(out.flights).toEqual([{ id: 'f1', date: '2025-01-01', v: 'old' }, { id: 'f2', date: '2025-02-02' }]);
    expect(out.residence).toEqual([{ date: '2025-01-01', location: 'canada' }, { date: '2025-02-02', location: 'transit' }]);
  });
  it('works with no existing record', () => {
    const out = mergeYearData(undefined, { flights: [{ id: 'f1' }], residence: [] });
    expect(out.flights).toEqual([{ id: 'f1' }]);
    expect(out.residence).toEqual([]);
  });
});
