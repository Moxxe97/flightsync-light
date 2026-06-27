import { describe, it, expect, vi } from 'vitest';
import { rescoreAllFromOfps } from '../rescoreOfps';

const mkFlight = (n, over = {}) => ({
  id: `pdf-AC000${n}-2026-06-0${n}-0`,
  date: `2026-06-0${n}`,
  flightNumber: `AC000${n}`,
  departure: 'YUL',
  arrival: 'CDG',
  totalTime: 7,
  canadianTime: 1.4, // 7 × 600/3000 — matches mkParsed(n, 600) exactly
  distance: 3000,
  canadianDistance: 600,
  notes: 'PDF OFP — old',
  ...over,
});

// parse result matching flight n, with new polygon numbers
const mkParsed = (n, canadianDistance) => ({
  flights: [{
    date: `2026-06-0${n}`,
    flightNumber: `AC000${n}`,
    departure: 'YUL',
    arrival: 'CDG',
    totalTime: 7,
    canadianTime: +(7 * canadianDistance / 3000).toFixed(2),
    distance: 3000,
    canadianDistance,
    notes: 'PDF OFP — new',
  }],
});

describe('rescoreAllFromOfps', () => {
  it('re-scores flights with stored OFPs and counts the rest', async () => {
    const flights = [mkFlight(1), mkFlight(2), mkFlight(3)]; // 3 has no OFP
    const ofpFlightIds = new Set([flights[0].id, flights[1].id]);
    const getRecord = vi.fn(async (id) =>
      id === flights[0].id || id === flights[1].id ? { data: new Uint8Array([1]) } : null);
    // flight 1 changes (600 → 500), flight 2 parses to identical values
    const parsePdf = vi.fn(async (_bytes, flight) =>
      flight.flightNumber === 'AC0001' ? mkParsed(1, 500) : mkParsed(2, 600));

    const { updates, stats } = await rescoreAllFromOfps({ flights, ofpFlightIds, getRecord, parsePdf });

    expect(stats).toEqual({ updated: 1, unchanged: 1, noOfp: 1, failed: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe(flights[0].id);
    expect(updates[0].canadianDistance).toBe(500);
    expect(getRecord).toHaveBeenCalledTimes(2);
  });

  it('counts a flight whose OFP bytes are gone as noOfp', async () => {
    const flights = [mkFlight(1)];
    const ofpFlightIds = new Set([flights[0].id]);
    const { stats, updates } = await rescoreAllFromOfps({
      flights, ofpFlightIds,
      getRecord: async () => null,
      parsePdf: async () => mkParsed(1, 500),
    });
    expect(stats.noOfp).toBe(1);
    expect(updates).toHaveLength(0);
  });

  it('counts parse exceptions and unmatched legs as failed and keeps going', async () => {
    const flights = [mkFlight(1), mkFlight(2)];
    const ofpFlightIds = new Set(flights.map(f => f.id));
    const parsePdf = vi.fn(async (_bytes, flight) => {
      if (flight.flightNumber === 'AC0001') throw new Error('pdf corrompu');
      return { flights: [] }; // parses but no matching leg
    });
    const { stats } = await rescoreAllFromOfps({
      flights, ofpFlightIds,
      getRecord: async () => ({ data: new Uint8Array([1]) }),
      parsePdf,
    });
    expect(stats.failed).toBe(2);
    expect(stats.updated).toBe(0);
  });

  it('reports progress per flight', async () => {
    const flights = [mkFlight(1), mkFlight(2)];
    const ofpFlightIds = new Set([flights[0].id]);
    const seen = [];
    await rescoreAllFromOfps({
      flights, ofpFlightIds,
      getRecord: async () => ({ data: new Uint8Array([1]) }),
      parsePdf: async () => mkParsed(1, 500),
      onProgress: (done, total) => seen.push([done, total]),
    });
    // only flights with an OFP enter the work list
    expect(seen).toEqual([[1, 1]]);
  });
});
