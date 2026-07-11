import { toIata } from '../data/icao-iata.js';

// Idempotent normalization of flights whose departure/arrival were saved as
// raw 4-letter ICAO (OFP imports of airports the old lookup table didn't
// know: LIRN, EGPH, EIDW, …). Codes are rewritten to IATA so they match
// monthly summaries, route history and CANADIAN_IATA classification.
//
//   normalizeFlightAirports(flights, { timestamp, deviceId })
//     → { flights, changed }
//
// Runs at every load AND on every path that brings flights in from outside
// (remote merge, backup restore) — pure and cheap, so re-running is free.
// _lastModified is deliberately NOT bumped unless the caller passes a
// timestamp: an equal-timestamp stale remote copy already loses last-write-
// wins (strict >), while a genuinely newer remote edit should win and then be
// re-normalized by the merge path — bumping here would instead let a stale
// local row clobber that newer edit. Rows with null/empty codes are left
// alone. Untouched rows keep their reference so callers can detect the no-op.
export function normalizeFlightAirports(flights, { timestamp, deviceId } = {}) {
  const changed = [];
  const out = flights.map((f) => {
    const dep = typeof f.departure === 'string' && f.departure ? toIata(f.departure) : f.departure;
    const arr = typeof f.arrival === 'string' && f.arrival ? toIata(f.arrival) : f.arrival;
    if (dep === f.departure && arr === f.arrival) return f;
    const norm = {
      ...f,
      departure: dep,
      arrival: arr,
      ...(timestamp !== undefined ? { _lastModified: timestamp } : {}),
      ...(deviceId !== undefined ? { _deviceId: deviceId } : {}),
    };
    changed.push(norm);
    return norm;
  });
  return { flights: out, changed };
}
