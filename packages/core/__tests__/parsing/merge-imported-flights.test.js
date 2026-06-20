import { describe, it, expect } from 'vitest';
import { mergeImportedFlights } from '../../src/parsing/merge-flights.js';

const opts = { timestamp: 1000, deviceId: 'dev-A' };

describe('mergeImportedFlights', () => {
  it('appends a flight whose date+flightNumber is new', () => {
    const existing = [{ id: 'a', date: '2026-01-01', flightNumber: 'AC1' }];
    const incoming = [{ id: 'pdf-AC2-2026-01-02-0', date: '2026-01-02', flightNumber: 'AC2', totalTime: 5 }];
    const { flights, added, updated } = mergeImportedFlights(existing, incoming, opts);
    expect(added).toBe(1);
    expect(updated).toBe(0);
    expect(flights).toHaveLength(2);
    expect(flights[1]).toMatchObject({ id: 'pdf-AC2-2026-01-02-0', _lastModified: 1000, _deviceId: 'dev-A' });
  });

  it('preserves the EXISTING id when updating a matched flight (no orphan)', () => {
    // The matched flight reached the app via another path (e.g. GCal) and has a
    // different id than the freshly-parsed one. The update must keep its id so
    // the old Firestore doc is overwritten in place, not orphaned + resurrected.
    const existing = [{ id: 'gcal-xyz', date: '2026-01-01', flightNumber: 'AC1', totalTime: 1 }];
    const incoming = [{ id: 'pdf-AC1-2026-01-01-0', date: '2026-01-01', flightNumber: 'AC1', totalTime: 9 }];
    const { flights, added, updated } = mergeImportedFlights(existing, incoming, opts);
    expect(added).toBe(0);
    expect(updated).toBe(1);
    expect(flights).toHaveLength(1);
    expect(flights[0].id).toBe('gcal-xyz');       // id preserved
    expect(flights[0].totalTime).toBe(9);          // fields updated
    expect(flights[0]._lastModified).toBe(1000);
  });

  it('returns only the added/updated rows as `changed` (delta), not the whole list', () => {
    // `changed` is what gets pushed to Firestore. It must exclude untouched
    // existing flights so a re-import never re-uploads (and thus resurrects) a
    // flight another device deleted.
    const existing = [
      { id: 'keep', date: '2026-01-01', flightNumber: 'AC1' },       // untouched
      { id: 'upd', date: '2026-01-02', flightNumber: 'AC2', totalTime: 1 },
    ];
    const incoming = [
      { id: 'pdf-AC2-2026-01-02-0', date: '2026-01-02', flightNumber: 'AC2', totalTime: 9 }, // updates 'upd'
      { id: 'pdf-AC3-2026-01-03-0', date: '2026-01-03', flightNumber: 'AC3' },               // new
    ];
    const { changed } = mergeImportedFlights(existing, incoming, opts);
    const ids = changed.map((f) => f.id).sort();
    expect(ids).toEqual(['pdf-AC3-2026-01-03-0', 'upd']); // updated keeps its id; new added
    expect(changed.some((f) => f.id === 'keep')).toBe(false); // untouched not pushed
    expect(changed.find((f) => f.id === 'upd').totalTime).toBe(9);
    expect(changed.every((f) => f._lastModified === 1000)).toBe(true);
  });

  it('does not mutate the input arrays', () => {
    const existing = [{ id: 'a', date: '2026-01-01', flightNumber: 'AC1' }];
    const incoming = [{ id: 'b', date: '2026-01-01', flightNumber: 'AC1' }];
    mergeImportedFlights(existing, incoming, opts);
    expect(existing[0].id).toBe('a');
    expect(existing).toHaveLength(1);
  });
});
