import { describe, it, expect } from 'vitest';
import { contentHash, buildYearJson, validateYearJson, ofpFileName, bpFileName, extFromMime } from '../driveArchive';

describe('contentHash', () => {
  it('is deterministic for the same data', () => {
    const rec = { year: '2025', flights: [{ id: 'f1' }], residence: [{ date: '2025-01-01' }], manifest: { flightCount: 1 } };
    expect(contentHash(rec)).toBe(contentHash({ ...rec }));
  });
  it('changes when flights/residence/manifest change', () => {
    const base = { flights: [{ id: 'f1' }], residence: [], manifest: { a: 1 } };
    const h0 = contentHash(base);
    expect(contentHash({ ...base, flights: [{ id: 'f2' }] })).not.toBe(h0);
    expect(contentHash({ ...base, residence: [{ date: 'x' }] })).not.toBe(h0);
    expect(contentHash({ ...base, manifest: { a: 2 } })).not.toBe(h0);
  });
  it('ignores fields other than flights/residence/manifest', () => {
    const a = { flights: [], residence: [], manifest: null, archivedAt: '2026-01-01' };
    const b = { flights: [], residence: [], manifest: null, archivedAt: '2099-12-31' };
    expect(contentHash(a)).toBe(contentHash(b));
  });
  it('returns an 8-char hex string', () => {
    expect(contentHash({ flights: [], residence: [], manifest: null })).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('buildYearJson', () => {
  it('packs the record + hash into the on-Drive shape', () => {
    const rec = { year: '2025', flights: [{ id: 'f1' }], residence: [{ date: 'd' }], manifest: { flightCount: 1 }, archivedAt: '2026-01-01' };
    const j = buildYearJson(rec, 'deadbeef');
    expect(j).toEqual({
      year: '2025',
      flights: [{ id: 'f1' }],
      residence: [{ date: 'd' }],
      manifest: { flightCount: 1 },
      archivedAt: '2026-01-01',
      contentHash: 'deadbeef',
    });
  });
});

describe('validateYearJson', () => {
  const good = buildYearJson(
    { year: '2025', flights: [{ id: 'f1' }], residence: [], manifest: { ofpFlightIds: [], bpDates: [] }, archivedAt: 'd' },
    contentHash({ flights: [{ id: 'f1' }], residence: [], manifest: { ofpFlightIds: [], bpDates: [] } }),
  );
  it('accepts the exact shape buildYearJson produces', () => {
    expect(validateYearJson(good)).toBeNull();
  });
  it('rejects non-objects', () => {
    expect(validateYearJson(null)).toBeTruthy();
    expect(validateYearJson([])).toBeTruthy();
    expect(validateYearJson('x')).toBeTruthy();
  });
  it('rejects non-array flights/residence', () => {
    expect(validateYearJson({ ...good, flights: { evil: 1 } })).toBeTruthy();
    expect(validateYearJson({ ...good, residence: 'x' })).toBeTruthy();
  });
  it('rejects missing year or contentHash', () => {
    const { year: _year, ...noYear } = good;
    expect(validateYearJson(noYear)).toBeTruthy();
    const { contentHash: _, ...noHash } = good;
    expect(validateYearJson(noHash)).toBeTruthy();
  });
});

describe('file names', () => {
  it('builds ofp / bp names and maps mime to ext', () => {
    expect(ofpFileName('gcal-123')).toBe('ofp-gcal-123.pdf');
    expect(bpFileName('2025-03-11', 0, 'pdf')).toBe('bp-2025-03-11-0.pdf');
    expect(extFromMime('application/pdf')).toBe('pdf');
    expect(extFromMime('image/png')).toBe('png');
    expect(extFromMime('image/jpeg')).toBe('jpg');
    expect(extFromMime('whatever')).toBe('bin');
  });
});
