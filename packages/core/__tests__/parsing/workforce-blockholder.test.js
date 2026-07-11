import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlightSummaryText } from '../../src/parsing/workforce.js';
import { reconcile } from '../../src/parsing/reconcile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, 'fixtures/flight-summary-jun-2026.txt'), 'utf8');

// June 2026 is the first blockholder month: the Roles column is EMPTY on every
// row ("… 0.0 480.0 Y 06/03/2026 …"), unlike the Feb/Mar reserve months where
// it held "RSV Award". The row regex must not require a Roles token — when it
// did, it swallowed the FltDt into Roles and consumed the following row(s),
// which mis-dated outbound legs, dropped every return leg, and made the
// reconciliation offer duplicates of already-stored flights.
describe('parseFlightSummaryText — June 2026 (blockholder, empty Roles column)', () => {
  const result = parseFlightSummaryText(fixture);
  const flown = result.flights.filter(f => f.flightType === 'flown');
  const dh = result.flights.filter(f => f.flightType === 'deadhead');

  it('returns month 2026-06', () => {
    expect(result.month).toBe('2026-06');
  });

  it('parses all 12 rows: 10 flown + 2 deadheads', () => {
    expect(result.flights).toHaveLength(12);
    expect(flown).toHaveLength(10);
    expect(dh).toHaveLength(2);
  });

  it('assigns each leg its OWN FltDt (outbounds must not inherit the return date)', () => {
    const got = Object.fromEntries(flown.map(f => [`${f.flightNumber} ${f.departure}>${f.arrival}`, f.date]));
    expect(got).toEqual({
      'AC0882 YUL>NAP': '2026-06-03',
      'AC0883 NAP>YUL': '2026-06-06',
      'AC0936 YUL>EDI': '2026-06-09',
      'AC0937 EDI>YUL': '2026-06-12',
      'AC0878 YUL>TLS': '2026-06-14',
      'AC0916 YUL>DUB': '2026-06-19',
      'AC0917 DUB>YUL': '2026-06-22',
      'AC0876 YUL>LYS': '2026-06-24',
      'AC0877 LYS>YUL': '2026-06-26',
      'AC0904 YUL>FCO': '2026-06-28',
    });
  });

  it('assigns each leg its OWN Flt Min block time (not the following row’s)', () => {
    const got = Object.fromEntries(flown.map(f => [`${f.flightNumber} ${f.date}`, f.blockMinutes]));
    expect(got).toEqual({
      'AC0882 2026-06-03': 467,
      'AC0883 2026-06-06': 524,
      'AC0936 2026-06-09': 359,
      'AC0937 2026-06-12': 371,
      'AC0878 2026-06-14': 398,
      'AC0916 2026-06-19': 359,
      'AC0917 2026-06-22': 384,
      'AC0876 2026-06-24': 410,
      'AC0877 2026-06-26': 453,
      'AC0904 2026-06-28': 463,
    });
  });

  it('still captures the pairing with an empty Roles column', () => {
    expect(flown[0].pairing).toBe('M7046');
  });

  it('computes deadhead block time from ATD→ATA UTC (TLS and FCO have coords)', () => {
    const ac879 = dh.find(f => f.flightNumber === 'AC0879');
    const ac893 = dh.find(f => f.flightNumber === 'AC0893');
    expect(ac879.date).toBe('2026-06-16');
    expect(ac879.blockMinutes).toBe(479);   // 13:33 CEST → 15:32 EDT
    expect(ac893.date).toBe('2026-07-02');
    expect(ac893.blockMinutes).toBe(529);   // 11:44 CEST → 14:33 EDT
  });

  it('flown block sum equals the document grand total (4188 min)', () => {
    const sum = flown.reduce((s, f) => s + f.blockMinutes, 0);
    expect(result.documentTotals.grandFltMinutes).toBe(4188);
    expect(sum).toBe(4188);
  });

  it('parses cleanly with zero warnings (NAP/EDI/DUB must have TZ coords)', () => {
    expect(result.warnings).toEqual([]);
  });

  it('reconciles as fully matched against correctly-stored OFP flights', () => {
    // Mirror of the flights the OFP import stores for this month (IATA codes,
    // FltDt-aligned dates). Every summary leg must match — zero "missing".
    const stored = [
      { date: '2026-06-03', flightNumber: 'AC0882' },
      { date: '2026-06-06', flightNumber: 'AC0883' },
      { date: '2026-06-09', flightNumber: 'AC0936' },
      { date: '2026-06-12', flightNumber: 'AC0937' },
      { date: '2026-06-14', flightNumber: 'AC0878' },
      { date: '2026-06-19', flightNumber: 'AC0916' },
      { date: '2026-06-22', flightNumber: 'AC0917' },
      { date: '2026-06-24', flightNumber: 'AC0876' },
      { date: '2026-06-26', flightNumber: 'AC0877' },
      { date: '2026-06-28', flightNumber: 'AC0904' },
    ];
    const { missing, matched } = reconcile(flown, stored);
    expect(missing).toEqual([]);
    expect(matched).toHaveLength(10);
  });

  it('warns loudly if row anchors outnumber parsed+skipped rows (no silent loss)', () => {
    // Corrupt one row beyond recognition: its anchor stays in the text but the
    // row can no longer parse — the parser must say so instead of staying quiet.
    const corrupted = fixture.replace('AC883   NAP   YUL   455.0   95.0', 'AC883 NAP YUL corrupted');
    const out = parseFlightSummaryText(corrupted);
    expect(out.warnings.some(w => /segment/i.test(w))).toBe(true);
  });

  it('refuses to stitch a later date into a truncated row (Roles is date-bounded)', () => {
    // Truncated row (FltMinNight missing) followed by a guarantee line whose
    // date is within the 3-day window: backtracking must NOT crawl over the
    // real FltDt and adopt the guarantee line's date/minutes — the row must
    // fail to parse and be reported by the anchor cross-check.
    const synth = 'Pilot Detail Flying Time/Pay Summary - June 2026\n' +
      '06/04/2026 09:40 06/03/2026 19:40 06/04/2026 10:08 06/03/2026 20:21 ' +
      'Flown Flight Leg M7046 AC882 YUL NAP 0.0 480.0 Y 06/03/2026 30.0 ' +
      'Trip Time Guarantee 06/04/2026 120.0 0.0\n';
    const out = parseFlightSummaryText(synth);
    expect(out.flights).toHaveLength(0);
    expect(out.warnings.some(w => /segment/i.test(w))).toBe(true);
  });

  it('warns when document totals are non-zero but no rows parsed (anchor drift)', () => {
    // If WorkForce ever rewords the anchor phrase, anchors AND rows are both
    // zero — the totals line is the anchor-independent tripwire.
    const drifted = fixture.replaceAll('Flown Flight Leg', 'Flown flight Leg')
                           .replaceAll('DeadHead Flown', 'DeadHead flown');
    const out = parseFlightSummaryText(drifted);
    expect(out.flights).toHaveLength(0);
    expect(out.warnings.some(w => /no rows were parsed/i.test(w))).toBe(true);
  });
});
