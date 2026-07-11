import { describe, it, expect } from 'vitest';
import { AIRPORTS } from '../../src/data/airports.js';
import { ICAO_TO_IATA, toIata } from '../../src/data/icao-iata.js';
import { CANADIAN_IATA } from '../../src/geo/canada.js';

describe('airport data parity', () => {
  it('every ICAO_TO_IATA value has coordinates in AIRPORTS', () => {
    const missing = [...new Set(Object.values(ICAO_TO_IATA))]
      .filter(iata => !AIRPORTS[iata]);
    expect(missing).toEqual([]);
  });

  it('no two ICAO codes map to the same IATA', () => {
    const values = Object.values(ICAO_TO_IATA);
    const dupes = values.filter((v, i) => values.indexOf(v) !== i);
    expect(dupes).toEqual([]);
  });

  it('all coordinates are within valid ranges', () => {
    for (const [iata, { lat, lon }] of Object.entries(AIRPORTS)) {
      expect(Math.abs(lat), `${iata} lat`).toBeLessThanOrEqual(90);
      expect(Math.abs(lon), `${iata} lon`).toBeLessThanOrEqual(180);
    }
  });

  it('every Canadian airport in the map is in CANADIAN_IATA and vice versa', () => {
    const canadianFromMap = Object.entries(ICAO_TO_IATA)
      .filter(([icao]) => icao.startsWith('CY'))
      .map(([, iata]) => iata);
    expect(canadianFromMap.filter(i => !CANADIAN_IATA.has(i))).toEqual([]);
    expect([...CANADIAN_IATA].filter(i => !canadianFromMap.includes(i))).toEqual([]);
  });

  it('toIata maps known ICAO, passes through IATA and unknown codes', () => {
    expect(toIata('EIDW')).toBe('DUB');
    expect(toIata('LIRN')).toBe('NAP');
    expect(toIata('cyul')).toBe('YUL');
    expect(toIata('YUL')).toBe('YUL');
    expect(toIata('ZZZZ')).toBe('ZZZZ');
    expect(toIata('')).toBe('');
    expect(toIata(null)).toBe('');
  });
});
