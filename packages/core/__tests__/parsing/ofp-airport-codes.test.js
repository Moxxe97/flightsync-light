import { describe, it, expect } from 'vitest';
import { parseOfp } from '../../src/parsing/ofp.js';

// The dispatch header prints both code forms ("CYUL/YUL - LIRN/NAP"). The
// parser must take the printed IATA half so airports outside the fallback
// table are never stored as raw 4-letter ICAO — a stored "LIRN" broke summary
// reconciliation display, route-history averaging, and TZ lookups, none of
// which know ICAO codes.
describe('parseOfp airport resolution', () => {
  it('uses the IATA half of the header route even for unmapped airports', () => {
    const text =
      'AC0882 / ACA882  03 JUN 2026   CYUL/YUL - LIRN/NAP\n' +
      'G/C 3665   EET 0800\nBLOCK TIME   0001   0800\n';
    const { flights } = parseOfp(text);
    expect(flights[0].departure).toBe('YUL');
    expect(flights[0].arrival).toBe('NAP');
  });

  it('still resolves table-known routes identically (regression)', () => {
    const text =
      'AC0050 / ACA50  11 MAR 2026   CYUL/YUL - VIDP/DEL\n' +
      'G/C 6088   EET 1246\nBLOCK TIME   0001   1246\n';
    const { flights } = parseOfp(text);
    expect(flights[0].departure).toBe('YUL');
    expect(flights[0].arrival).toBe('DEL');
  });

  it('marks a domestic regional leg as fully Canadian (CYYT now in the map)', () => {
    const text =
      'AC0690 / ACA690  05 JUL 2026   CYUL/YUL - CYYT/YYT\n' +
      'G/C 900   EET 0230\nBLOCK TIME   0001   0230\n';
    const { flights } = parseOfp(text);
    expect(flights[0].arrival).toBe('YYT');
    // bothCanadian branch: full block time counts as Canadian
    expect(flights[0].canadianTime).toBe(flights[0].totalTime);
  });
});
