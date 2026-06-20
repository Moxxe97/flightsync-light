import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { listArchiveYears, saveYearToArchive, migrateLocalStorageArchives } from '../archiveStore';

// Fresh IndexedDB + localStorage per test.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory(); // pristine in-memory IndexedDB per test (no open-connection blocking)
  localStorage.clear();
});

describe('saveYearToArchive + listArchiveYears', () => {
  it('round-trips a year and builds its manifest', async () => {
    await saveYearToArchive('2025', {
      flights: [{ id: 'f1', date: '2025-04-01' }],
      residence: [{ date: '2025-04-01', location: 'canada' }],
      ofpFlightIds: ['f1'],
      bpDates: ['2025-04-01'],
    });
    const years = await listArchiveYears();
    expect(years).toHaveLength(1);
    expect(years[0].year).toBe('2025');
    expect(years[0].flights).toEqual([{ id: 'f1', date: '2025-04-01' }]);
    expect(years[0].manifest.flightCount).toBe(1);
    expect(years[0].manifest.ofpFlightIds).toEqual(['f1']);
    expect(years[0].manifest.bpDates).toEqual(['2025-04-01']);
  });

  it('merges on re-archive (dedupe + manifest rebuild) and lists newest-first', async () => {
    await saveYearToArchive('2024', { flights: [{ id: 'a', date: '2024-01-01' }], residence: [], ofpFlightIds: ['a'] });
    await saveYearToArchive('2024', { flights: [{ id: 'a', date: '2024-01-01' }, { id: 'b', date: '2024-02-01' }], residence: [], ofpFlightIds: ['a', 'b'] });
    await saveYearToArchive('2025', { flights: [], residence: [] });
    const years = await listArchiveYears();
    expect(years.map((y) => y.year)).toEqual(['2025', '2024']);
    const y2024 = years.find((y) => y.year === '2024');
    expect(y2024.flights.map((f) => f.id)).toEqual(['a', 'b']); // deduped, not [a,a,b]
    // manifest must reflect the MERGED set, not the stale first save
    expect(y2024.manifest.flightCount).toBe(2);
    expect(y2024.manifest.ofpFlightIds).toEqual(['a', 'b']);
  });
});

describe('migrateLocalStorageArchives', () => {
  it('moves legacy localStorage archives into the store and clears the keys', async () => {
    localStorage.setItem('ac-flights-archive-2023', JSON.stringify([{ id: 'x', date: '2023-05-05' }]));
    localStorage.setItem('ac-residence-archive-2023', JSON.stringify([{ date: '2023-05-05', location: 'transit' }]));
    localStorage.setItem('ac-flights-data', JSON.stringify([{ id: 'live' }])); // must NOT be touched

    const migrated = await migrateLocalStorageArchives({ ofpFlightIds: ['x'], bpDates: [] });
    expect(migrated).toBe(1);

    const years = await listArchiveYears();
    expect(years).toHaveLength(1);
    expect(years[0].year).toBe('2023');
    expect(years[0].flights).toEqual([{ id: 'x', date: '2023-05-05' }]);
    expect(years[0].manifest.ofpFlightIds).toEqual(['x']);

    expect(localStorage.getItem('ac-flights-archive-2023')).toBeNull();
    expect(localStorage.getItem('ac-residence-archive-2023')).toBeNull();
    expect(localStorage.getItem('ac-flights-data')).not.toBeNull();
  });

  it('is idempotent (second run is a no-op)', async () => {
    localStorage.setItem('ac-flights-archive-2022', JSON.stringify([{ id: 'q', date: '2022-09-09' }]));
    localStorage.setItem('ac-residence-archive-2022', JSON.stringify([]));
    expect(await migrateLocalStorageArchives()).toBe(1);
    expect(await migrateLocalStorageArchives()).toBe(0);
    const years = await listArchiveYears();
    expect(years).toHaveLength(1);
  });
});
