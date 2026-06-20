// Normalize a flight number to the same "carrier + 4-digit" form used by
// parseFlightSummary so storage entries like "AC50" still match "AC0050".
function normalize(fltNum) {
  if (!fltNum) return '';
  const m = String(fltNum).toUpperCase().match(/^([A-Z]{1,3})0*(\d{1,4})([A-Z]?)$/);
  if (!m) return String(fltNum).toUpperCase();
  return `${m[1]}${m[2].padStart(4, '0')}${m[3]}`;
}

function keyFor(flight) {
  return `${flight.date}|${normalize(flight.flightNumber)}`;
}

export function reconcile(summaryFlights, storedFlights) {
  const storedKeys = new Set(storedFlights.map(keyFor));
  const missing = [];
  const matched = [];
  for (const f of summaryFlights) {
    if (storedKeys.has(keyFor(f))) matched.push(f);
    else missing.push(f);
  }
  return { missing, matched };
}
