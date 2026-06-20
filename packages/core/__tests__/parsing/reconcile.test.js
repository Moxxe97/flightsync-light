import { describe, it, expect } from 'vitest';
import { reconcile } from '../../src/parsing/reconcile.js';

const summaryFlights = [
  { date: '2026-03-07', flightNumber: 'AC0944', departure: 'YUL', arrival: 'PUJ', blockMinutes: 313, pairing: 'M7001' },
  { date: '2026-03-11', flightNumber: 'AC0050', departure: 'YUL', arrival: 'DEL', blockMinutes: 1390, pairing: 'M7042' },
  { date: '2026-03-21', flightNumber: 'AC0051', departure: 'DEL', arrival: 'YUL', blockMinutes: 353, pairing: 'M7318A' },
];

describe('reconcile', () => {
  it('returns an empty missing list when every flight is already stored', () => {
    const stored = summaryFlights.map(s => ({ ...s, id: `f-${s.date}-${s.flightNumber.toLowerCase()}` }));
    const { missing, matched } = reconcile(summaryFlights, stored);
    expect(missing).toEqual([]);
    expect(matched).toHaveLength(3);
  });

  it('returns only flights that are in summary but not in storage', () => {
    const stored = [{ ...summaryFlights[0], id: 'f-2026-03-07-ac0944' }];
    const { missing } = reconcile(summaryFlights, stored);
    expect(missing.map(f => f.flightNumber)).toEqual(['AC0050', 'AC0051']);
  });

  it('treats flights with the same flight number on different dates as distinct', () => {
    // Summary has a second AC0050 on a different date.
    const extended = [
      ...summaryFlights,
      { date: '2026-03-18', flightNumber: 'AC0050', departure: 'YUL', arrival: 'DEL', blockMinutes: 1390, pairing: 'M7318A' },
    ];
    const stored = [{ ...summaryFlights[1], id: 'f-2026-03-11-ac0050' }];
    const { missing } = reconcile(extended, stored);
    expect(missing).toHaveLength(3);
    expect(missing.some(f => f.date === '2026-03-18' && f.flightNumber === 'AC0050')).toBe(true);
  });

  it('matches storage entries regardless of zero-padding (AC50 vs AC0050)', () => {
    const stored = [{ date: '2026-03-11', flightNumber: 'AC50', departure: 'YUL', arrival: 'DEL', id: 'f-2026-03-11-ac0050' }];
    const { missing, matched } = reconcile(
      [summaryFlights[1]],
      stored,
    );
    expect(missing).toEqual([]);
    expect(matched).toHaveLength(1);
  });
});
