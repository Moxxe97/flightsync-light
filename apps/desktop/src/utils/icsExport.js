// ─── ICS export (local .ics file, no Google) ─────────────────────

import { icsEscape } from './exportEscape';

// ─── ICS Export ───────────────────────────────────────────────
function flightToICSEvent(flight) {
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
    `Vol: ${flight.flightNumber}`,
    `Route: ${flight.departure} → ${flight.arrival}`,
    `Durée totale: ${flight.totalTime}h`,
    `Temps canadien: ${flight.canadianTime}h (${canPct}%)`,
    `Distance GC: ${flight.distance || '?'} nm`,
    `Distance canadienne: ${flight.canadianDistance || '?'} nm`,
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
  const events = flights.map(flightToICSEvent).join('\r\n');
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
