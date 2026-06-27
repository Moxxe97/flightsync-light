// Batch re-score: re-parse each flight's stored (trimmed) OFP and refresh its
// geo-derived tax fields (canadianDistance/canadianTime) — used after a geo
// model change (e.g. the CANADA_POLY coastline redraw) so existing flights can
// be corrected without re-dropping every PDF.
//
// Dependency-injected for testability and platform reuse:
//   getRecord(flightId) → { data: bytes } | null   (IDB, with cloud fallback)
//   parsePdf(bytes, flight) → parseOfp() result     (pdfjs adapter)
//   onProgress(done, total)                         (optional UI hook)
import { rescoreFlight } from '@flightsync/core/parsing';

export async function rescoreAllFromOfps({ flights, ofpFlightIds, getRecord, parsePdf, onProgress }) {
  const withOfp = flights.filter((f) => ofpFlightIds.has(f.id));
  const stats = {
    updated: 0,
    unchanged: 0,
    noOfp: flights.length - withOfp.length,
    failed: 0,
  };
  const updates = [];

  let done = 0;
  for (const flight of withOfp) {
    try {
      const rec = await getRecord(flight.id);
      if (!rec?.data) {
        stats.noOfp++;
        continue;
      }
      const parsed = await parsePdf(rec.data, flight);
      const result = rescoreFlight(flight, parsed?.flights);
      if (!result) {
        stats.failed++;
      } else if (result.changed) {
        stats.updated++;
        updates.push(result.flight);
      } else {
        stats.unchanged++;
      }
    } catch (err) {
      console.warn('[rescore] failed for', flight.flightNumber, flight.date, err?.message);
      stats.failed++;
    } finally {
      done++;
      onProgress?.(done, withOfp.length);
    }
  }

  return { updates, stats };
}
