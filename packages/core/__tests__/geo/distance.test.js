import { describe, it, expect } from 'vitest';
import { greatCircleCanadianDistance, greatCircleCanadianFraction, haversineDistance } from '../../src/geo/distance.js';

const YUL = { lat: 45.4706, lon: -73.7408 };
const PUJ = { lat: 18.5675, lon: -68.3634 };

describe('YUL ↔ PUJ great-circle Canadian distance', () => {
  it('total great-circle distance is ~1637 nm', () => {
    const total = haversineDistance(YUL.lat, YUL.lon, PUJ.lat, PUJ.lon);
    expect(total).toBeGreaterThan(1550);
    expect(total).toBeLessThan(1700);
  });

  it('Canadian portion is approximately 40 nm (not 500, not 880)', () => {
    const canadian = greatCircleCanadianDistance(YUL.lat, YUL.lon, PUJ.lat, PUJ.lon);
    expect(canadian).toBeGreaterThanOrEqual(20);
    expect(canadian).toBeLessThanOrEqual(80);
  });
});

describe('haversineDistance', () => {
  it('computes YUL→CDG at roughly 3000 nm', () => {
    // YUL 45.47 N, 73.74 W ; CDG 49.00 N, 2.55 E
    const nm = haversineDistance(45.47, -73.74, 49.00, 2.55);
    expect(nm).toBeGreaterThan(2900);
    expect(nm).toBeLessThan(3100);
  });
  it('returns 0 for identical points', () => {
    expect(haversineDistance(45, -73, 45, -73)).toBe(0);
  });

  // H5: near-antipodal (and exactly antipodal) pairs used to push the
  // haversine `a` term just above 1.0 due to floating-point error, making
  // Math.asin(Math.sqrt(a)) return NaN. Half the Earth's circumference in
  // nm is π × 3440.065 ≈ 10808.
  it('returns a finite ~half-circumference distance for an exact antipodal pair', () => {
    const nm = haversineDistance(0, 0, 0, 180);
    expect(Number.isFinite(nm)).toBe(true);
    expect(nm).toBeGreaterThan(10700);
    expect(nm).toBeLessThan(10900);
  });
  it('returns a finite ~half-circumference distance for a near-antipodal pair (fp-error edge case where a > 1)', () => {
    // These two points are (numerically) antipodal to within 1e-6°; the
    // haversine `a` term rounds to 1.0000000000000004 here, pushing
    // Math.sqrt(a) fractionally above 1 and Math.asin(...) into NaN
    // without a clamp (verified in Node against Light's own distance.js).
    const nm = haversineDistance(69.16864714481952, 25.220029187932795, -69.16864761031958, -154.77997071813172);
    expect(Number.isFinite(nm)).toBe(true);
    expect(nm).toBeGreaterThan(10700);
    expect(nm).toBeLessThan(10900);
  });
});

describe('greatCircleCanadianDistance', () => {
  it('returns ~100% of distance for YUL→YVR (entirely in Canada)', () => {
    const total = haversineDistance(45.47, -73.74, 49.19, -123.18);
    const canadian = greatCircleCanadianDistance(45.47, -73.74, 49.19, -123.18);
    expect(canadian / total).toBeGreaterThan(0.95);
  });
  it('returns a small fraction for YUL→CDG', () => {
    const total = haversineDistance(45.47, -73.74, 49.00, 2.55);
    const canadian = greatCircleCanadianDistance(45.47, -73.74, 49.00, 2.55);
    expect(canadian / total).toBeGreaterThan(0.05);
    expect(canadian / total).toBeLessThan(0.4);
  });
  it('returns 0 for LHR→CDG (no Canadian segment)', () => {
    const canadian = greatCircleCanadianDistance(51.47, -0.45, 49.00, 2.55);
    expect(canadian).toBe(0);
  });
  it('returns a finite value (not NaN) for a near-antipodal pair', () => {
    const canadian = greatCircleCanadianDistance(69.16864714481952, 25.220029187932795, -69.16864761031958, -154.77997071813172);
    expect(Number.isFinite(canadian)).toBe(true);
  });
});

describe('greatCircleCanadianFraction', () => {
  it('is ~1 for an all-Canada great circle (YUL→YVR)', () => {
    expect(greatCircleCanadianFraction(45.47, -73.74, 49.19, -123.18)).toBeGreaterThan(0.95);
  });
  it('is 0 for a leg entirely outside Canada (CDG→LYS)', () => {
    expect(greatCircleCanadianFraction(49.00, 2.55, 45.73, 5.08)).toBe(0);
  });
  it('measures a partial leg whose path dips into the US between two Canadian endpoints (YYZ→YWG ≈ half over Lake Superior / US)', () => {
    const f = greatCircleCanadianFraction(43.68, -79.62, 49.91, -97.24);
    expect(f).toBeGreaterThan(0.3);
    expect(f).toBeLessThan(0.7);
  });
  it('returns a finite fraction in [0,1] (not NaN) for a near-antipodal pair', () => {
    const f = greatCircleCanadianFraction(69.16864714481952, 25.220029187932795, -69.16864761031958, -154.77997071813172);
    expect(Number.isFinite(f)).toBe(true);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThanOrEqual(1);
  });
});
