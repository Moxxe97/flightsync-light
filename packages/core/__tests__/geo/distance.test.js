import { describe, it, expect } from 'vitest';
import { greatCircleCanadianDistance, haversineDistance } from '../../src/geo/distance.js';

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
});
