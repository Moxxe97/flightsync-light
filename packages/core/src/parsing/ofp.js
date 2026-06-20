import { pdfToText } from './pdf-text.js';
import { CANADIAN_IATA, isInCanada } from '../geo/index.js';

// ─── Constants ────────────────────────────────────────────────
const ICAO_TO_IATA = {
  CYUL:'YUL', CYVR:'YVR', CYYZ:'YYZ', CYOW:'YOW', CYYC:'YYC',
  CYEG:'YEG', CYHZ:'YHZ', CYWG:'YWG', CYQB:'YQB', CYXE:'YXE',
  VIDP:'DEL', VABB:'BOM', VOMM:'MAA', VOBL:'BLR', VOCI:'COK',
  LFPG:'CDG', LFPO:'ORY', LFBO:'TLS', LFLL:'LYS', LFMN:'NCE',
  EGLL:'LHR', EGKK:'LGW', EGSS:'STN', EGCC:'MAN',
  EDDF:'FRA', EDDM:'MUC', EDDB:'BER', LSZH:'ZRH', LSGG:'GVA', LOWW:'VIE',
  EHAM:'AMS', EBBR:'BRU', ENGM:'OSL', EKCH:'CPH', ESSA:'ARN',
  LEMD:'MAD', LEBL:'BCN', LPPT:'LIS', LIRF:'FCO', LIMC:'MXP',
  LIPZ:'VCE', LGAV:'ATH',
  OMDB:'DXB', OERK:'RUH', OTHH:'DOH', HECA:'CAI', FAOR:'JNB',
  VHHH:'HKG', RCTP:'TPE', RJAA:'NRT', RJTT:'HND', RJBB:'KIX',
  RKSI:'ICN', WSSS:'SIN', VTBS:'BKK', WMKK:'KUL',
  ZGGG:'CAN', ZBAA:'PEK', ZSPD:'PVG', YSSY:'SYD', YMML:'MEL',
  MMUN:'CUN', MMMX:'MEX', MROC:'SJO', MUVR:'VRA', MDSD:'SDQ',
  MDPC:'PUJ',
  KORD:'ORD', KJFK:'JFK', KLAX:'LAX', KSFO:'SFO', KATL:'ATL',
  KDFW:'DFW', KMIA:'MIA', KBOS:'BOS', KEWR:'EWR', KIAD:'IAD',
  KDEN:'DEN', KSEA:'SEA',
};

const MONTHS = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };

// ─── Cut Page Detection ───────────────────────────────────────
// Returns the 0-based index of the last page containing waypoint lat/lon
// coordinates. This is the last routing page (destination airport).
// Falls back to last page if no waypoints found.
function findCutPageIndex(pageTexts) {
  const latRe = /[NS]\s*\d{2}\s*\d{2}\.\d+/;
  let lastIdx = pageTexts.length - 1;
  for (let i = pageTexts.length - 1; i >= 0; i--) {
    if (latRe.test(pageTexts[i])) {
      lastIdx = i;
      break;
    }
  }
  return lastIdx;
}

// ─── Date Helpers ─────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  const s = str.trim().toUpperCase();

  // "11 MAR 2026" or "11MAR2026" or "11.MAR.2026"
  const m1 = s.match(/(\d{1,2})[\s.]*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[\s.]*(\d{4})/);
  if (m1) {
    const y = m1[3], mo = String(MONTHS[m1[2]]).padStart(2,'0'), d = m1[1].padStart(2,'0');
    return `${y}-${mo}-${d}`;
  }
  // ISO "2026-03-11"
  const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return m2[0];

  return null;
}

// ─── Time Helpers ─────────────────────────────────────────────
function hhmm(str) {
  if (!str) return 0;
  const s = str.trim().replace(/[Hh:]/, ':');
  const m = s.match(/^(\d{1,2}):?(\d{2})$/);
  if (m) return parseInt(m[1]) + parseInt(m[2]) / 60;
  const f = parseFloat(s);
  return isNaN(f) ? 0 : f;
}

// ─── Airport Helper ───────────────────────────────────────────
function resolve(code) {
  if (!code) return '';
  const u = code.toUpperCase().trim();
  return ICAO_TO_IATA[u] ?? u;
}

// ─── Waypoint Parser ──────────────────────────────────────────
// AC OFP (Smart4Aviation) flight log format, each waypoint has:
//   LAT line: "N 4528.2  0000 .....  34  207  M030  ....."
//   LON line: "W07344.5   45   296   387   023.5"
//             lon^^^^^^^^  ^^dist to next waypoint
// Lat format: N/S + DDMM.M  (2-digit deg + 2-digit min + decimal)
// Lon format: E/W + DDDMM.M (3-digit deg + 2-digit min + decimal)
// pdfjs joins items with spaces, so "N" and "4528.2" may be separate tokens
function parseWaypointsFromOFP(text) {
  const T = text.toUpperCase();
  const flightLogIdx = T.indexOf('FLIGHT LOG');
  if (flightLogIdx === -1) return [];
  const logText = T.slice(flightLogIdx);

  // Find all latitudes: N/S + optional space + 2-digit deg + 2-digit min + decimal
  const latRe = /([NS])\s*(\d{2})\s*(\d{2}\.\d+)/g;
  const latMatches = [];
  let m;
  while ((m = latRe.exec(logText)) !== null) {
    const lat = (parseInt(m[2]) + parseFloat(m[3]) / 60) * (m[1] === 'S' ? -1 : 1);
    // Sanity check: valid latitude range
    if (lat < -90 || lat > 90) continue;
    latMatches.push({ lat, endPos: m.index + m[0].length });
  }

  // Find all longitudes: E/W + optional space + 3-digit deg + 2-digit min + decimal + space + distance
  const lonRe = /([EW])\s*(\d{3})\s*(\d{2}\.\d+)\s+(\d+)/g;
  const lonMatches = [];
  while ((m = lonRe.exec(logText)) !== null) {
    const lon = (parseInt(m[2]) + parseFloat(m[3]) / 60) * (m[1] === 'W' ? -1 : 1);
    const dist = parseInt(m[4]);
    // Sanity check: valid longitude range
    if (lon < -180 || lon > 180) continue;
    lonMatches.push({ lon, dist, pos: m.index });
  }

  // Match each lat to the nearest following lon (within 500 chars = one waypoint row)
  const waypoints = [];
  let lonIdx = 0;
  for (const latEntry of latMatches) {
    // Advance to next lon that comes after this lat
    while (lonIdx < lonMatches.length && lonMatches[lonIdx].pos < latEntry.endPos) lonIdx++;
    if (lonIdx >= lonMatches.length) break;
    const lonEntry = lonMatches[lonIdx];
    if (lonEntry.pos - latEntry.endPos < 500) {
      waypoints.push({ lat: latEntry.lat, lon: lonEntry.lon, dist: lonEntry.dist });
      lonIdx++;
    }
  }

  return waypoints;
}

// ─── Canadian Distance from Waypoints ─────────────────────────
// For each segment A→B, sums the portion of the segment within Canadian airspace.
// Cross-border segments are interpolated at 20 steps for accuracy.
function calcCanadianFromWaypoints(waypoints) {
  let canadianDist = 0;
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const segDist = a.dist;
    if (segDist === 0) continue;

    const aIn = isInCanada(a.lat, a.lon);
    const bIn = isInCanada(b.lat, b.lon);

    if (aIn && bIn) {
      canadianDist += segDist;
    } else if (aIn || bIn) {
      // Cross-border segment: interpolate at 20 steps
      let stepsInCanada = 0;
      const STEPS = 20;
      for (let k = 0; k <= STEPS; k++) {
        const t = k / STEPS;
        const lat = a.lat + t * (b.lat - a.lat);
        const lon = a.lon + t * (b.lon - a.lon);
        if (isInCanada(lat, lon)) stepsInCanada++;
      }
      canadianDist += segDist * (stepsInCanada / (STEPS + 1));
    }
    // else: both outside, 0 contribution
  }
  return Math.round(canadianDist);
}

// ─── AC OFP Parser ────────────────────────────────────────────
// Based on actual Smart4Aviation / Jeppesen AC dispatch format:
//   Header: "AC0050 / ACA50  11 MAR 2026   CYUL/YUL - VIDP/DEL"
//   Planning summary: "G/C 6088   EET 1246"
//   Actuals (p4):     "BLOCK TIME   1317   1400"
//   Flight log (p4+): waypoints with lat/lon and segment distances

export function parseOfp(text) {
  const T = text.toUpperCase();

  // ── 1. Flight numbers ─────────────────────────────────────
  const fnRaw = [...T.matchAll(/\bAC[A]?\s*0*(\d{1,4})\b/g)];
  let flightNums = [...new Set(fnRaw.map(m => m[1].padStart(4,'0')))];

  if (flightNums.length === 0) {
    return { flights: [], error: 'Aucun numéro de vol AC trouvé dans ce document.' };
  }

  // Un PDF piégé peut produire des milliers de "vols" — borne dure (audit #25/G4).
  const MAX_LEGS = 8;
  let warning;
  if (flightNums.length > MAX_LEGS) {
    warning = `${flightNums.length} numéros de vol détectés — import limité aux ${MAX_LEGS} premiers.`;
    flightNums = flightNums.slice(0, MAX_LEGS);
  }

  // ── 2. Dates ──────────────────────────────────────────────
  const HEADER = T.slice(0, 2000);
  const dateRe = /(\d{1,2})[\s.]*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[\s.]*(\d{4})/g;
  const isoRe  = /(\d{4})-(\d{2})-(\d{2})/g;
  const rawDates = [
    ...[...HEADER.matchAll(dateRe)].map(m => parseDate(m[0])),
    ...[...HEADER.matchAll(isoRe)].map(m => m[0]),
  ].filter(Boolean);
  const dates = [...new Set(rawDates)]
    .filter(d => d >= '2020-01-01' && d <= '2035-12-31')
    .sort();

  // ── 3. Route — AC OFP header format: "CYUL/YUL - VIDP/DEL" ──
  const headerRoute = T.match(/([A-Z]{4})\/[A-Z]{3}\s*-\s*([A-Z]{4})\/[A-Z]{3}/);
  let dep = '', arr = '';
  if (headerRoute) {
    dep = resolve(headerRoute[1]);
    arr = resolve(headerRoute[2]);
  } else {
    const generic = [...T.matchAll(/([A-Z]{3,4})\s*\/\s*([A-Z]{3,4})/g)];
    const known = new Set([...Object.keys(ICAO_TO_IATA), ...Object.values(ICAO_TO_IATA)]);
    for (const m of generic) {
      const a = resolve(m[1]);
      if ((known.has(a) || CANADIAN_IATA.has(a)) && a.length === 3) { dep = a; break; }
    }
    for (const m of [...generic].reverse()) {
      const b = resolve(m[2]);
      if (b !== dep && b.length === 3) { arr = b; break; }
    }
  }

  // ── 4. Block time ─────────────────────────────────────────
  let blockTime = 0;
  const btMatch = T.match(/BLOCK\s+TIME\s+(\d{4})\s+(\d{4})/);
  if (btMatch) blockTime = hhmm(btMatch[2]);

  // ── 5. EET ────────────────────────────────────────────────
  let eet = 0;
  const eetMatch = T.match(/\bEET\s+(\d{4})\b/);
  if (eetMatch) eet = hhmm(eetMatch[1]);

  const totalTime = parseFloat((blockTime || eet).toFixed(2));

  // ── 6. Great circle distance ──────────────────────────────
  let gcDist = 0;
  const gcMatch = T.match(/G\/C\s+(\d{4,5})\b/);
  if (gcMatch) gcDist = parseInt(gcMatch[1]);
  if (!gcDist) {
    const disMatch = T.match(/\bDIS\s+(\d{4,5})\b/);
    if (disMatch) gcDist = parseInt(disMatch[1]);
  }

  // ── 7. Canadian distance from waypoints ───────────────────
  const waypoints = parseWaypointsFromOFP(text);

  let canadianDistance, canadianTime, calcMethod;
  const bothCanadian = CANADIAN_IATA.has(dep) && CANADIAN_IATA.has(arr);
  if (waypoints.length >= 2) {
    // Waypoints are authoritative for any route direction (south/east/west/domestic).
    // The 880nm cap below is an eastbound-transatlantic approximation and is wrong
    // for southbound routes (e.g. YUL-PUJ ≈ 40nm over Canada, not 880nm).
    const rawCanDist = calcCanadianFromWaypoints(waypoints);
    canadianDistance = gcDist > 0 ? Math.min(rawCanDist, gcDist) : rawCanDist;
    if (gcDist > 0) {
      canadianTime = parseFloat(Math.min(totalTime, totalTime * canadianDistance / gcDist).toFixed(2));
    } else {
      // No parseable G/C header — use the waypoint-summed distance as the denominator
      // rather than attributing 100% of block time to Canada.
      const wpTotal = waypoints.reduce((s, w) => s + w.dist, 0);
      canadianTime = wpTotal > 0
        ? parseFloat((totalTime * canadianDistance / wpTotal).toFixed(2))
        : totalTime;
    }
    calcMethod = `waypoints (${waypoints.length} fixes)`;
  } else if (bothCanadian) {
    canadianDistance = gcDist || 880;
    canadianTime = totalTime;
    calcMethod = 'domestic (full distance)';
  } else {
    canadianDistance = Math.min(880, gcDist || 880);
    canadianTime = gcDist > 0
      ? parseFloat((totalTime * canadianDistance / gcDist).toFixed(2))
      : parseFloat((totalTime * 0.145).toFixed(2));
    calcMethod = 'international (880nm cap, fallback)';
  }

  // ── 8. Confidence ─────────────────────────────────────────
  const conf = (dates.length ? 25 : 0) + (dep && arr ? 35 : 0) + (totalTime ? 25 : 0) + (gcDist ? 15 : 0);

  // ── 9. Build flight objects ───────────────────────────────
  const date = dates[0] ?? new Date().toISOString().slice(0,10);

  // id is a pure function of the OFP content (flight number + date + index) —
  // NOT Date.now() — so re-importing the same OFP yields the same id and updates
  // the existing flight row in place instead of orphaning it and
  // resurrecting a duplicate (which would double-count CRA hours).
  const flights = flightNums.map((num, i) => ({
    id: `pdf-AC${num}-${date}-${i}`,
    date,
    flightNumber: `AC${num}`,
    departure: dep || 'YUL',
    arrival: arr || '???',
    totalTime,
    canadianTime,
    distance: gcDist,
    canadianDistance,
    notes: `PDF OFP — ${canadianDistance}/${gcDist || '?'} nm (${gcDist > 0 ? ((canadianDistance/gcDist)*100).toFixed(1) : '?'}% canadien) [${calcMethod}]`,
    _confidence: conf,
  }));

  return warning ? { flights, warning } : { flights };
}

// ─── Entry point ──────────────────────────────────────────────
export async function processPdfFile(file) {
  try {
    const { fullText, pageTexts } = await pdfToText(file);
    const result = parseOfp(fullText);
    const cutPageIndex = findCutPageIndex(pageTexts);
    return { ...result, fileName: file.name, rawTextPreview: fullText, cutPageIndex };
  } catch (err) {
    throw err;
  }
}
