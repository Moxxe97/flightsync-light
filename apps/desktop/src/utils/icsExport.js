// ─── ICS export (local .ics file, no Google) ─────────────────────

import { icsEscape } from './exportEscape';

// ─── ICS Export ───────────────────────────────────────────────
// ICS lines are CRLF-delimited; unlike SUMMARY/DESCRIPTION (escaped) and UID
// (allowlisted chars), `flight.date` was built straight into DTSTART/DTEND
// with no check, so an embedded CRLF could inject forged VEVENT blocks.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Returns the VEVENT text, or null if the flight's date isn't a plain
// YYYY-MM-DD string — such a flight is skipped entirely rather than risking
// injection or aborting the whole export.
function flightToICSEvent(flight) {
  if (!ISO_DATE_RE.test(flight.date)) return null;
  const dateStr = flight.date.replace(/-/g, ''); // "20260311"
  const startHour = 8; // Default departure time (no actual time in OFP data)
  const durationMins = Math.round((flight.totalTime || 0) * 60);

  const pad = (n) => String(n).padStart(2, '0');
  const startDT = `${dateStr}T${pad(startHour)}0000Z`;
  const endTotalMins = startHour * 60 + durationMins;
  const endH = Math.floor(endTotalMins / 60) % 24;
  const endM = endTotalMins % 60;
  const endDT = `${dateStr}T${pad(endH)}${pad(endM)}00Z`;

  const summary = icsEscape(`✈️ ${flight.flightNumber} ${flight.departure}→${flight.arrival}`);
  const canPct = flight.distance > 0
    ? ((flight.canadianDistance / flight.distance) * 100).toFixed(1)
    : '0';
  const description = icsEscape([
    `Flight: ${flight.flightNumber}`,
    `Route: ${flight.departure} → ${flight.arrival}`,
    `Total duration: ${flight.totalTime}h`,
    `Canadian time: ${flight.canadianTime}h (${canPct}%)`,
    `Distance GC: ${flight.distance || '?'} nm`,
    `Canadian distance: ${flight.canadianDistance || '?'} nm`,
    flight.notes ? `Notes: ${flight.notes}` : '',
  ].filter(Boolean).join('\n'));

  const uid = `${String(flight.id || flight.flightNumber + flight.date).replace(/[^\w.@-]/g, '_')}@flight-sync`;

  return [
    'BEGIN:VEVENT',
    `DTSTART:${startDT}`,
    `DTEND:${endDT}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `UID:${uid}`,
    'END:VEVENT',
  ].join('\r\n');
}

export function exportICS(flights) {
  const events = flights.map(flightToICSEvent).filter(Boolean).join('\r\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FlightSync Light//FlightSync Light//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    events,
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AC-Flights-${new Date().toISOString().split('T')[0]}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
