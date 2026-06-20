import { pdfToText } from './pdf-text.js';
import tzLookup from 'tz-lookup';
import { DateTime } from 'luxon';
import { AIRPORTS } from '../data/airports.js';

const SUMMARY_HEADER = 'Pilot Detail Flying Time/Pay Summary';

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Row format from real pdfjs extraction of WorkForce monthly summary PDFs:
//   "<STA_date> <STA_time> <STD_date> <STD_time> <ATA_date> <ATA_time> <ATD_date> <ATD_time>
//    (Flown Flight Leg|DeadHead Flown) [pairing] <flight#> <origin> <dest>
//    <PaidMinDay> <PaidMinNight> [Y|N OVS NAV] <Roles> <FltDt> <FltMinDay> <FltMinNight>"
// Pairing and OVS NAV flag appear only on Flown rows. Block time comes from the
// trailing FltMinDay+FltMinNight columns (the airline's authoritative TZ-correct
// value, not from subtracting wall-clock ATD/ATA which crosses timezones).
const ROW_RE = new RegExp(
  '(\\d{2}/\\d{2}/\\d{4})\\s+(\\d{1,2}:\\d{2})\\s+' +    // STA date, time
  '(\\d{2}/\\d{2}/\\d{4})\\s+(\\d{1,2}:\\d{2})\\s+' +    // STD date, time
  '(\\d{2}/\\d{2}/\\d{4})\\s+(\\d{1,2}:\\d{2})\\s+' +    // ATA date, time
  '(\\d{2}/\\d{2}/\\d{4})\\s+(\\d{1,2}:\\d{2})\\s+' +    // ATD date, time
  '(Flown Flight Leg|DeadHead Flown)\\s+' +              // type anchor
  '(?:(\\S+)\\s+)?' +                                    // optional pairing
  '([A-Z]{1,3}\\d{1,4}[A-Z]?)\\s+' +                     // flight number
  '([A-Z]{3})\\s+([A-Z]{3})\\s+' +                       // origin, dest
  '([\\d.]+)\\s+([\\d.]+)\\s+' +                         // Paid Min Day, Paid Min Night
  '(?:[YN]\\s+)?' +                                      // optional OVS NAV
  '(.+?)\\s+' +                                          // Roles (lazy)
  '(\\d{2}/\\d{2}/\\d{4})\\s+' +                         // Flt Dt
  '([\\d.]+)\\s+([\\d.]+)',                              // Flt Min Day, Flt Min Night
  'g',
);

function mmddyyyyToIso(mmddyyyy) {
  const [mm, dd, yyyy] = mmddyyyy.split('/');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeFlightNumber(raw) {
  const m = raw.match(/^([A-Z]{1,3})0*(\d{1,4})([A-Z]?)$/);
  if (!m) return raw;
  return `${m[1]}${m[2].padStart(4, '0')}${m[3]}`;
}

function detectMonth(text) {
  const after = text.split(SUMMARY_HEADER)[1] ?? '';
  const m = after.match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const idx = MONTH_NAMES.findIndex(n => n.toLowerCase() === m[1].toLowerCase());
  if (idx < 1) return null;
  return `${m[2]}-${String(idx).padStart(2, '0')}`;
}

function detectFleet(text, matchIndex) {
  const before = text.slice(0, matchIndex);
  const lastMainline = before.lastIndexOf('Mainline');
  const lastRouge = before.lastIndexOf('Rouge');
  return lastRouge > lastMainline ? 'rouge' : 'mainline';
}

const SECTION_TOTAL_RE = /([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+Total\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/g;

function stripComma(s) { return parseFloat(s.replace(/,/g, '')); }

function parseDocumentTotals(text) {
  // Find each section's "<Paid> <Paid> Total <Flt> <Flt>" line and assign by position.
  const matches = [...text.matchAll(SECTION_TOTAL_RE)];
  let mainline = null, rouge = null;
  for (const m of matches) {
    const fltDay = stripComma(m[3]);
    const fltNight = stripComma(m[4]);
    const minutes = Math.round(fltDay + fltNight);
    const fleet = detectFleet(text, m.index);
    if (fleet === 'mainline' && mainline === null) mainline = minutes;
    else if (fleet === 'rouge' && rouge === null) rouge = minutes;
  }
  const grand = (mainline ?? 0) + (rouge ?? 0);
  return {
    mainlineFltMinutes: mainline,
    rougeFltMinutes: rouge,
    grandFltMinutes: mainline === null && rouge === null ? null : grand,
  };
}

export function parseFlightSummaryText(text) {
  if (!text || !text.includes(SUMMARY_HEADER)) {
    throw new Error('Text is not a flight summary (header not found).');
  }

  const flights = [];
  const warnings = [];

  for (const match of text.matchAll(ROW_RE)) {
    const [
      , staDate, staTime, stdDate, stdTime, ataDate, ataTime, atdDate, atdTime,
      type, pairingRaw, rawFltNum, origin, dest,
      /* paidDay */, /* paidNight */, /* roles */,
      fltDate, fltDay, fltNight,
    ] = match;

    const flightType = type === 'DeadHead Flown' ? 'deadhead' : 'flown';
    const pairing = pairingRaw ?? '';
    const fleet = detectFleet(text, match.index);

    const atdUtc = localToUtc(atdDate, atdTime, origin);
    const ataUtc = localToUtc(ataDate, ataTime, dest);
    if (atdUtc === null) warnings.push(`Unknown airport TZ for origin ${origin}`);
    if (ataUtc === null) warnings.push(`Unknown airport TZ for destination ${dest}`);

    let blockSeconds, blockMinutes;
    if (flightType === 'deadhead') {
      if (atdUtc && ataUtc) {
        blockSeconds = Math.round((Date.parse(ataUtc) - Date.parse(atdUtc)) / 1000);
        blockMinutes = Math.round(blockSeconds / 60);
      } else {
        blockSeconds = null;
        blockMinutes = null;
        warnings.push(`Cannot compute DH block time for ${normalizeFlightNumber(rawFltNum)} (missing TZ data)`);
      }
    } else {
      blockMinutes = Math.round(parseFloat(fltDay) + parseFloat(fltNight));
      blockSeconds = blockMinutes * 60;
    }

    // Block-time validation only applies to flown rows. DH rows have Flt Min = 0
    // by document convention (DH does not generate paid flying minutes). DH block
    // time is computed via ATD→ATA UTC subtraction above.
    if (flightType === 'flown' &&
        (!Number.isFinite(blockMinutes) || blockMinutes <= 0 || blockMinutes > 24 * 60)) {
      warnings.push(`Row with implausible block time (${blockMinutes} min) for ${rawFltNum} on ${fltDate}`);
      continue;
    }

    // Cross-source sanity check: for flown rows we kept, the PDF column block time and
    // the ATD-ATA UTC subtraction should agree within 2 minutes. A larger divergence
    // indicates a TZ-data bug (wrong IANA zone, missing airport coord, DST edge case).
    if (flightType === 'flown' && atdUtc && ataUtc) {
      const utcSeconds = Math.round((Date.parse(ataUtc) - Date.parse(atdUtc)) / 1000);
      if (Math.abs(utcSeconds - blockSeconds) > 120) {
        warnings.push(
          `${normalizeFlightNumber(rawFltNum)} on ${mmddyyyyToIso(fltDate)}: ` +
          `column block ${blockSeconds}s differs from ATD-ATA UTC ${utcSeconds}s by >2min ` +
          `(possible TZ data error)`
        );
      }
    }

    flights.push({
      date: mmddyyyyToIso(fltDate),
      flightNumber: normalizeFlightNumber(rawFltNum),
      departure: origin,
      arrival: dest,
      flightType,
      fleet,
      pairing,
      staLocal: { date: staDate, time: staTime },
      stdLocal: { date: stdDate, time: stdTime },
      ataLocal: { date: ataDate, time: ataTime },
      atdLocal: { date: atdDate, time: atdTime },
      atdUtc,
      ataUtc,
      blockSeconds,
      blockMinutes,
    });
  }

  const month = detectMonth(text);
  if (!month) warnings.push('Could not detect report month from header');
  const documentTotals = parseDocumentTotals(text);
  return { month, flights, documentTotals, warnings };
}

export async function parseFlightSummary(file) {
  const { fullText } = await pdfToText(file);
  return parseFlightSummaryText(fullText);
}

export function localToUtc(mmddyyyy, hhmm, iata) {
  const coords = AIRPORTS[iata];
  if (!coords) return null;
  const zone = tzLookup(coords.lat, coords.lon);
  const [mm, dd, yyyy] = mmddyyyy.split('/');
  const [hh, mins] = hhmm.split(':');
  const time = `${hh.padStart(2, '0')}:${mins}`;
  return DateTime
    .fromFormat(`${yyyy}-${mm}-${dd} ${time}`, 'yyyy-MM-dd HH:mm', { zone })
    .toUTC()
    .toISO();
}

export { SUMMARY_HEADER };
