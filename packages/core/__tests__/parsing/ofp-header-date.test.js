import { describe, it, expect } from 'vitest';
import { parseOfp } from '../../src/parsing/ofp.js';

// The flight date must come from the release header line ("AC0051 / ACA51
// 01 MAR 2026"), not from "the earliest date in the first 2000 characters".
// Page 1 ends with a running footer carrying the UTC scheduled departure
// ("ACA 0051 VIDP/CYUL 28.FEB.2026/1855Z"), which for an overnight eastbound
// departure is the PREVIOUS day. Whether that footer fell inside the 2000-char
// window depended only on the length of the dispatcher remarks — on a real
// DEL→YUL OFP it sat 68 chars past it, and one shorter remark flipped the date
// (breaking the pay-summary match and, at New Year, the fiscal year).
const HEADER = 'AIR CANADA FLIGHT PLAN RELEASE 1 AC0051 / ACA51 01 MAR 2026 VIDP/DEL - CYUL/YUL CAPT ';
const REMARKS = 'DX RMKS ATC FUEL FOR ANY ATC VECTORING ------- ';
const FOOTER_EARLIER = 'ACA 0051 VIDP/CYUL 28.FEB.2026/1855Z [ GENERATED: 28FEB/1537Z ] Page 1 of 70 ';
const FOOTER_LATER = 'ACA 0050 CYUL/VIDP 12.MAR.2026/0200Z [ GENERATED: 11MAR/2330Z ] Page 1 of 85 ';
const BODY = '\nG/C 6088 EET 1530\nBLOCK TIME 1612 1615\n';

describe('parseOfp — flight date anchored to the release header line', () => {
  it('keeps the header date when the page-1 footer carries an earlier UTC date inside the window', () => {
    const { flights } = parseOfp(HEADER + REMARKS + FOOTER_EARLIER + BODY);
    expect(flights[0].date).toBe('2026-03-01');
    expect(flights[0].id).toBe('pdf-AC0051-2026-03-01-0');
  });

  it('keeps the header date across a New Year footer (fiscal year must not move)', () => {
    const text = HEADER.replace('01 MAR 2026', '01 JAN 2026') + REMARKS +
      'ACA 0051 VIDP/CYUL 31.DEC.2025/1855Z [ GENERATED: 31DEC/1537Z ] Page 1 of 70 ' + BODY;
    expect(parseOfp(text).flights[0].date).toBe('2026-01-01');
  });

  it('is unchanged for the common westbound case (footer UTC date later than the header)', () => {
    const text = HEADER.replace('AC0051 / ACA51 01 MAR 2026 VIDP/DEL - CYUL/YUL', 'AC0050 / ACA50 11 MAR 2026 CYUL/YUL - VIDP/DEL') + REMARKS + FOOTER_LATER + BODY;
    expect(parseOfp(text).flights[0].date).toBe('2026-03-11');
  });

  it('falls back to the window scan when there is no release header line', () => {
    const { flights } = parseOfp('CYUL/YUL - CYYZ/YYZ\nAC0123 01JAN2026\nBLOCK TIME 1.20');
    expect(flights[0].date).toBe('2026-01-01');
  });
});
