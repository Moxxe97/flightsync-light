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

// The southern mainland chord used to run straight from Cape Breton to the Gulf
// of Maine, cutting across Nova Scotia and scoring its whole southern half
// (Halifax, Yarmouth, Cape Sable) OUT. The chord is replaced by a coast + 12 nm
// wrap of the NS Atlantic shore. (SW New Brunswick / the St Croix corner —
// St Andrews, Grand Manan — remains a known coarse area, out of scope here.)
describe('isInCanada — southern Nova Scotia (coast + 12 nm)', () => {
  describe('Canadian land that must be inside', () => {
    it.each([
      ['Halifax', 44.65, -63.57],
      ['Chebucto Head', 44.50, -63.52],
      ['Lunenburg', 44.38, -64.31],
      ['Liverpool NS', 44.04, -64.72],
      ['Shelburne NS', 43.76, -65.32],
      ['Barrington NS', 43.56, -65.62],
      ['Cape Sable Island (south tip of NS)', 43.46, -65.62],
      ['Yarmouth', 43.84, -66.12],
    ])('%s', (_n, lat, lon) => {
      expect(isInCanada(lat, lon)).toBe(true);
    });
  });

  describe('neighbours that must stay correctly classified (no regression)', () => {
    it.each([
      ['Sydney NS (Cape Breton)', 46.14, -60.19, true],
      ['Truro NS', 45.37, -63.28, true],
      ['Digby NS (Fundy shore)', 44.62, -65.76, true],
      ['Annapolis Royal NS', 44.74, -65.51, true],
      ['Saint John NB', 45.27, -66.06, true],
      ['Charlottetown PEI', 46.24, -63.13, true],
      ['Moncton NB', 46.09, -64.77, true],
      ['Bangor ME (US)', 44.80, -68.81, false],
      ['Eastport ME (US)', 44.91, -66.99, false],
      ['Calais ME (US)', 45.19, -67.28, false],
      ['Gulf of Maine', 42.50, -66.50, false],
      ['Georges Bank', 41.70, -67.00, false],
      ['open Atlantic south of Halifax', 43.00, -62.00, false],
      ['open Atlantic SE of Nova Scotia', 43.00, -64.50, false],
    ])('%s', (_n, lat, lon, expected) => {
      expect(isInCanada(lat, lon)).toBe(expected);
    });
  });
});

// The west edge was a coarse chord running inland of the real coastline, so
// Vancouver Island's outer coast and all of Haida Gwaii (~100 nm offshore)
// scored OUT. Replaced by a coast + 12 nm wrap of southern/western Vancouver
// Island and Haida Gwaii, threaded through the Haro Strait / Juan de Fuca
// border so the US side (San Juan Is, Cape Flattery) stays out.
// (The Alaska panhandle north of Dixon Entrance remains a known coarse area.)
describe('isInCanada — BC / Pacific coast (coast + 12 nm)', () => {
  describe('Canadian land that must be inside', () => {
    it.each([
      ['Victoria', 48.43, -123.37],
      ['Sooke', 48.37, -123.73],
      ['Nanaimo', 49.16, -123.94],
      ['Tofino', 49.15, -125.90],
      ['Ucluelet', 48.94, -125.55],
      ['Campbell River', 50.03, -125.27],
      ['Port Hardy', 50.68, -127.37],
      ['Cape Scott (NW tip Vancouver Is)', 50.78, -128.43],
      ['Bella Bella (central coast)', 52.18, -128.16],
      ['Prince Rupert', 54.31, -130.32],
      ['Sandspit, Haida Gwaii', 53.25, -131.81],
      ['Queen Charlotte City, Haida Gwaii', 53.25, -132.07],
      ['Masset, Haida Gwaii', 54.01, -132.15],
    ])('%s', (_n, lat, lon) => {
      expect(isInCanada(lat, lon)).toBe(true);
    });
  });

  describe('US / open Pacific that must stay outside (no regression)', () => {
    it.each([
      ['Cape Flattery WA', 48.38, -124.71],
      ['Neah Bay WA', 48.37, -124.62],
      ['Port Angeles WA', 48.12, -123.43],
      ['Friday Harbor (San Juan Is, US)', 48.53, -123.02],
      ['Bellingham WA', 48.75, -122.49],
      ['Seattle', 47.61, -122.33],
      ['Ketchikan AK', 55.34, -131.64],
      ['open Pacific west of Haida Gwaii', 53.00, -134.50],
      ['open Pacific west of Vancouver Is', 49.00, -127.80],
    ])('%s', (_n, lat, lon) => {
      expect(isInCanada(lat, lon)).toBe(false);
    });
  });

  it('keeps mainland BC interior inside (no regression)', () => {
    expect(isInCanada(49.28, -123.12)).toBe(true); // Vancouver
    expect(isInCanada(53.92, -122.75)).toBe(true); // Prince George
    expect(isInCanada(55.94, -129.99)).toBe(true); // Stewart BC
  });
});
