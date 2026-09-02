import { describe, it, expect } from 'vitest';
import { parseOfp } from '../../src/parsing/ofp.js';

// Flight numbers must come from the document header, not from a whole-text
// scan. Weather pages carry METAR remarks such as "RMK AC8" (altocumulus,
// 8 oktas) which match the AC<digits> pattern; scanned across the whole text
// they became extra "flights" sharing the real flight's date, route and hours
// — i.e. the block time counted twice or three times. 6 of 45 real OFPs carry
// such remarks; only the adapter's 15-page cap kept them out (the shortest
// real OFP's weather page is page 16).
const HEADER = 'AIR CANADA FLIGHT PLAN RELEASE 1 AC0328 / ACA328 04 APR 2026 CYYC/YYC - CYUL/YUL CAPT ';
const BODY = '\nG/C 1624 EET 0330\nBLOCK TIME 0404 0420\n';
const WEATHER = '\nCYUL SA 040600 18003KT 15SM OVC110 22/12 A2981 RMK AC8 SLP097 DENSITY ALT 1200FT= ' +
  'CYOW SA 040600 25003KT 25SM BKN094 15/11 A2987 RMK AC7 SLP118= FC NIL FT AMD 04\n';

describe('parseOfp — flight numbers come from the header, not from weather remarks', () => {
  it('ignores METAR "RMK AC8"/"AC7" remarks later in the document', () => {
    const { flights, warning } = parseOfp(HEADER + BODY + WEATHER);
    expect(flights.map(f => f.flightNumber)).toEqual(['AC0328']);
    expect(warning).toBeUndefined();
  });

  it('ignores the same remarks when they sit far beyond the header window (real page layout)', () => {
    const filler = '\nNOTAM ' + 'X'.repeat(3000) + '\n';
    const { flights } = parseOfp(HEADER + BODY + filler + WEATHER);
    expect(flights.map(f => f.flightNumber)).toEqual(['AC0328']);
  });

  it('still reads the flight number when the header line is the only mention', () => {
    const { flights } = parseOfp(HEADER + BODY);
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({ flightNumber: 'AC0328', date: '2026-04-04', departure: 'YYC', arrival: 'YUL' });
  });

  it('falls back to the whole text when the header window has no flight number', () => {
    const filler = 'DISPATCH REMARKS ' + '-'.repeat(2100) + '\n';
    const { flights } = parseOfp(filler + 'AC0123 01JAN2026 CYUL/YUL - CYYZ/YYZ\nBLOCK TIME 0100 0120');
    expect(flights.map(f => f.flightNumber)).toEqual(['AC0123']);
  });
});
