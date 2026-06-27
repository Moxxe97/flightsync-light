import { describe, it, expect } from 'vitest';
import { isInCanada, CANADIAN_IATA } from '../../src/geo/canada.js';

describe('CANADIAN_IATA', () => {
  it('contains the expected Canadian hubs', () => {
    expect(CANADIAN_IATA.has('YUL')).toBe(true);
    expect(CANADIAN_IATA.has('YVR')).toBe(true);
    expect(CANADIAN_IATA.has('YYZ')).toBe(true);
    expect(CANADIAN_IATA.has('CDG')).toBe(false);
  });
});

describe('isInCanada', () => {
  it('returns true for Montreal', () => {
    expect(isInCanada(45.47, -73.74)).toBe(true);
  });
  it('returns true for Vancouver', () => {
    expect(isInCanada(49.19, -123.18)).toBe(true);
  });
  it('returns false for New York', () => {
    expect(isInCanada(40.64, -73.78)).toBe(false);
  });
  it('returns false for Paris', () => {
    expect(isInCanada(49.00, 2.55)).toBe(false);
  });
});

// Eastern boundary = actual sovereign territory (coastline + 12 nm territorial
// sea), derived from Natural Earth 50m data — NOT the old hand-drawn offshore
// line. CRA basis: sovereign territory only (no FIR, no oceanic).
describe('isInCanada — eastern seaboard follows official territory', () => {
  describe('Canadian territory that must be inside', () => {
    it.each([
      ['St. John’s / YYT', 47.62, -52.74],
      ['Cape Spear (easternmost point of Canada)', 47.52, -52.62],
      ['~5 nm off Cape Spear (territorial sea)', 47.52, -52.50],
      ['Cape Race, Avalon Peninsula', 46.66, -53.07],
      ['Fogo Island', 49.72, -54.10],
      ['Cape Bonavista', 48.70, -53.09],
      ['Belle Isle (strait entrance)', 51.93, -55.35],
      ['Nain / YDP', 56.55, -61.68],
      ['Hopedale', 55.45, -60.20],
      ['Cartwright', 53.71, -57.02],
      ['Cape Chidley (northern tip of Labrador)', 60.38, -64.43],
      ['Resolution Island', 61.35, -64.90],
      ['Cape Dyer, Baffin Island', 66.58, -61.26],
      ['Alert, Ellesmere Island', 82.50, -62.35],
    ])('%s', (_name, lat, lon) => {
      expect(isInCanada(lat, lon)).toBe(true);
    });

    it.each([
      ['Hudson Strait (internal waters)', 62.50, -70.00],
      ['Strait of Belle Isle', 51.50, -56.50],
      ['Gulf of St. Lawrence', 48.50, -62.00],
    ])('%s stays inside', (_name, lat, lon) => {
      expect(isInCanada(lat, lon)).toBe(true);
    });
  });

  describe('international water / foreign territory that must be outside', () => {
    it.each([
      ['Labrador Sea ~70 nm off Okak', 57.30, -59.50],
      ['Labrador Sea ~80 nm off Hebron', 58.00, -60.00],
      ['mid Labrador Sea', 56.00, -54.00],
      ['~60 nm east of St. John’s', 47.60, -51.20],
      ['Davis Strait midway to Greenland', 65.00, -57.00],
      ['Pituffik / Thule, GREENLAND', 76.53, -68.70],
      ['Greenland ice sheet at 78N', 78.00, -62.00],
    ])('%s', (_name, lat, lon) => {
      expect(isInCanada(lat, lon)).toBe(false);
    });
  });

  it('a track segment through the old Labrador-Sea bulge counts 0 Canadian nm', async () => {
    const { greatCircleCanadianDistance } = await import('../../src/geo/distance.js');
    expect(greatCircleCanadianDistance(57.3, -59.5, 58.0, -60.0)).toBe(0);
  });

  it('EGPH→YUL great-circle Canadian distance stays in the realistic 750–870 nm band', async () => {
    const { greatCircleCanadianDistance } = await import('../../src/geo/distance.js');
    const canadian = greatCircleCanadianDistance(55.95, -3.37, 45.47, -73.74);
    expect(canadian).toBeGreaterThan(750);
    expect(canadian).toBeLessThan(870);
  });
});
