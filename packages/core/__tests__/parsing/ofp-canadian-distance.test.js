import { describe, it, expect } from 'vitest';
import { calcCanadianFromWaypoints } from '../../src/parsing/ofp.js';
import { haversineDistance } from '../../src/geo/distance.js';

// Each waypoint carries the great-circle distance to the NEXT fix in `dist`
// (the OFP "DIS" column), matching parseWaypointsFromOFP's output.

// ── AC0876 YUL→LYS (real OFP, 24 Jun 2026) ────────────────────────────────
// Departs over Quebec, crosses into the US near Houlton ME (HULTN), then the
// long HULTN→ALLRY leg flies BACK over New Brunswick, the Gulf of St. Lawrence
// and Newfoundland before going feet-wet into the Atlantic. Both endpoints of
// that leg (HULTN, ALLRY) are outside Canada, so endpoint-only scoring drops
// the entire re-entry — the bug this fixes.
const AC0876 = [
  ['CYUL', 45.4700, -73.7417, 35], ['SUXET', 45.2050, -73.1667, 7],
  ['NOVUN', 45.2100, -72.9933, 10], ['ESRAM', 45.2917, -72.7867, 7],
  ['RABIK', 45.2983, -72.6100, 59], ['TOC', 45.4083, -71.2117, 8],
  ['ANTOV', 45.4283, -71.0233, 139], ['HULTN', 46.0400, -67.8333, 686],
  ['ALLRY', 50.5000, -52.0000, 82], ['51N050W', 51.0000, -50.0000, 378],
  ['52N040W', 52.0000, -40.0000, 370], ['52N030W', 52.0000, -30.0000, 378],
  ['51N020W', 51.0000, -20.0000, 200], ['SOMAX', 50.0000, -15.0000, 39],
  ['ATSUR', 50.0000, -14.0000, 242], ['TAKAS', 49.0000, -8.0000, 20],
  ['ALUTA', 49.0050, -7.4983, 215], ['KORER', 47.6850, -2.5017, 112],
  ['LEMKA', 46.6283, -0.2500, 80], ['BEBIX', 45.9500, 1.4000, 59],
  ['VALKU', 45.9983, 2.8183, 3], ['TOD', 46.0017, 2.8783, 20],
  ['LABAL', 46.0283, 3.3550, 26], ['LESPI', 46.1133, 3.9583, 64],
  ['LFLL', 45.7250, 5.0817, 0],
].map(([, lat, lon, dist]) => ({ lat, lon, dist }));

describe('calcCanadianFromWaypoints — re-entry after leaving via the US', () => {
  it('counts the Maritimes + Gulf + Newfoundland crossing inside the HULTN→ALLRY leg (AC0876)', () => {
    // The whole route is ~3238 nm; the Canadian portion is the Quebec departure
    // (~124 nm) PLUS ~590 nm of NB/Gulf/Newfoundland on the transatlantic leg.
    const canadian = calcCanadianFromWaypoints(AC0876);
    expect(canadian).toBeGreaterThan(600); // endpoint-only scoring returns ~124
    expect(canadian).toBeLessThan(800);
  });
});

// ── YYZ→YWG→YVR domestic with a southern US dip ───────────────────────────
// The direct YYZ→YWG great circle bows south of Lake Superior through US
// airspace even though BOTH endpoints are Canadian. Endpoint-only scoring
// counts the whole leg as Canadian (over-claiming); the fix must subtract the
// US portion. (Confirms the fix is symmetric — it can lower a number too.)
const YYZ = { lat: 43.6777, lon: -79.6248 };
const YWG = { lat: 49.9100, lon: -97.2399 };
const YVR = { lat: 49.1939, lon: -123.1844 };
const d1 = haversineDistance(YYZ.lat, YYZ.lon, YWG.lat, YWG.lon);
const d2 = haversineDistance(YWG.lat, YWG.lon, YVR.lat, YVR.lon);
const YYZ_YVR = [
  { ...YYZ, dist: Math.round(d1) },
  { ...YWG, dist: Math.round(d2) },
  { ...YVR, dist: 0 },
];

describe('calcCanadianFromWaypoints — Canadian endpoints, path dips into the US', () => {
  it('excludes the US portion of the YYZ→YWG leg instead of counting it all as Canada', () => {
    const total = Math.round(d1 + d2);
    const canadian = calcCanadianFromWaypoints(YYZ_YVR);
    // Endpoint-only scoring returns ~total (both legs Canada→Canada). The path
    // is ~half-US on the first leg, so the real figure is well below total.
    expect(canadian).toBeLessThan(total - 200);
    expect(canadian).toBeGreaterThan(total * 0.7); // still mostly Canada
  });
});
