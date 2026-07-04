// Re-score a stored flight from a fresh parseOfp() of its stored (trimmed) OFP —
// used when the geo model changes (e.g. CANADA_POLY redraw) so existing flights
// can pick up corrected canadianDistance/canadianTime without re-dropping PDFs.
//
// Only geo-derived fields are refreshed (distance, canadianDistance,
// canadianTime, auto notes). User-controlled fields are preserved: identity
// (id, date, flightNumber, airports), a hand-edited totalTime (canadianTime is
// re-scaled to it via the parsed Canadian ratio), and any custom notes.

const AUTO_NOTES_PREFIX = 'PDF OFP —';

export function rescoreFlight(flight, parsedFlights) {
  const match = (parsedFlights || []).find(
    (p) => p.date === flight.date && p.flightNumber === flight.flightNumber,
  );
  if (!match) return null;

  const totalTime = flight.totalTime > 0 ? flight.totalTime : match.totalTime;
  let distance = match.distance > 0 ? match.distance : flight.distance;
  let canadianDistance = match.canadianDistance;

  // Canadian ratio as parseOfp computed it (it already handled the G/C vs
  // waypoint-sum denominator); fall back to the distance ratio if the OFP had
  // no parseable time.
  const ratio = match.totalTime > 0
    ? match.canadianTime / match.totalTime
    : (distance > 0 ? canadianDistance / distance : null);
  let canadianTime = ratio != null
    ? parseFloat((totalTime * ratio).toFixed(2))
    : match.canadianTime;

  // Defense-in-depth (H5): a geo edge case (e.g. near-antipodal waypoints)
  // can yield a non-finite computed value. Never let that overwrite a
  // previously-good stored value, and never report a spurious `changed`
  // caused by a NaN comparison (NaN !== x is always true).
  if (!Number.isFinite(distance)) distance = flight.distance;
  if (!Number.isFinite(canadianDistance)) canadianDistance = flight.canadianDistance;
  if (!Number.isFinite(canadianTime)) canadianTime = flight.canadianTime;

  const keepNotes = flight.notes && !flight.notes.startsWith(AUTO_NOTES_PREFIX);
  const notes = keepNotes ? flight.notes : (match.notes ?? flight.notes);

  const changed =
    canadianDistance !== flight.canadianDistance ||
    canadianTime !== flight.canadianTime ||
    distance !== flight.distance;

  return {
    flight: { ...flight, totalTime, distance, canadianDistance, canadianTime, notes },
    changed,
  };
}
