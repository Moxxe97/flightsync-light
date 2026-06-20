import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlightSummaryText, localToUtc } from '../../src/parsing/workforce.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, 'fixtures/flight-summary-mar-2026.txt'), 'utf8');

describe('parseFlightSummaryText', () => {
  const result = parseFlightSummaryText(fixture);

  it('returns month YYYY-MM for March 2026', () => {
    expect(result.month).toBe('2026-03');
  });

  it('returns exactly 6 flown flights (no deadheads, no totals, no headers)', () => {
    expect(result.flights).toHaveLength(6);
  });

  it('normalizes flight numbers to carrier prefix + 4 digits', () => {
    const numbers = result.flights.map(f => f.flightNumber).sort();
    expect(numbers).toEqual(['AC0050', 'AC0050', 'AC0051', 'AC0051', 'AC0944', 'AC0947']);
  });

  it('converts dates to YYYY-MM-DD from MM/DD/YYYY', () => {
    expect(result.flights[0].date).toBe('2026-03-07');
    expect(result.flights.at(-1).date).toBe('2026-03-21');
  });

  it('captures origin and arrival IATA codes', () => {
    const first = result.flights[0];
    expect(first.departure).toBe('YUL');
    expect(first.arrival).toBe('PUJ');
  });

  it('reads block time from PDF Flt Min columns (YUL→PUJ same-day)', () => {
    const yulPuj = result.flights.find(f => f.date === '2026-03-07' && f.arrival === 'PUJ');
    // March fixture: Flt Min Day=253, Flt Min Night=0 → 253 min total block
    expect(yulPuj.blockMinutes).toBe(253);
  });

  it('reads block time from PDF Flt Min columns (YUL→DEL overnight cross-TZ)', () => {
    const yulDel = result.flights.find(f => f.date === '2026-03-11');
    // March fixture: Flt Min Day=320, Flt Min Night=500 → 820 min total block (13h40 real YUL→DEL)
    expect(yulDel.blockMinutes).toBe(820);
  });

  it('keeps the pairing identifier', () => {
    expect(result.flights[0].pairing).toBe('M7001');
  });

  it('rejects text that is not a Pilot Detail Flying Time/Pay Summary', () => {
    const bogus = 'This is a random document with no header.';
    expect(() => parseFlightSummaryText(bogus)).toThrow(/not a flight summary/i);
  });

  it('reports zero warnings for a clean PDF', () => {
    expect(result.warnings).toEqual([]);
  });

  it('emits deadhead rows tagged flightType="deadhead", not "flown"', () => {
    const withDH = 'Pilot Detail Flying Time/Pay Summary - March 2026\n' +
      '03/22/2026 12:00 03/22/2026 10:00 03/22/2026 12:00 03/22/2026 10:00 ' +
      'DeadHead Flown AC100 YUL JFK 120.0 0.0 DH 03/22/2026 0.0 0.0\n';
    const out = parseFlightSummaryText(withDH);
    expect(out.flights.filter(f => f.flightType === 'flown')).toHaveLength(0);
  });

  it('skips rows with non-finite block time and records a warning', () => {
    // Header + a single Flown Flight Leg row in the real pdfjs layout, with
    // ATA time equal to ATD time so block = 0 → rejected with a warning.
    const bogus = 'Pilot Detail Flying Time/Pay Summary - March 2026\n' +
      '03/07/2026 14:00 03/07/2026 08:30 ' +             // STA, STD
      '03/07/2026 08:00 03/07/2026 08:00 ' +             // ATA == ATD → block = 0
      'Flown Flight Leg M7001 AC944 YUL PUJ 0.0 0.0 Y RSV Award 03/07/2026 0.0 0.0\n';
    const out = parseFlightSummaryText(bogus);
    expect(out.flights).toHaveLength(0);
    expect(out.warnings.length).toBe(1);
    expect(out.warnings[0]).toMatch(/implausible block time/i);
  });

  it('exposes documentTotals.mainlineFltMinutes for March', () => {
    // March fixture Mainline subtotal: 1,932.0 + 2,128.0 = 4060
    expect(result.documentTotals.mainlineFltMinutes).toBe(4060);
  });

  it('tags rows under the Rouge section header with fleet "rouge"', () => {
    // Both Feb and March fixtures have empty Rouge sections, so detectFleet's
    // rouge branch is unexercised by real data. Synthesize a minimal text whose
    // Rouge section header sits just before a flown row.
    const synth =
      'Pilot Detail Flying Time/Pay Summary - February 2026\n' +
      'Mainline pilot info Rouge pilot info Actual Flying Mainline ' +
      'Total 0.0 0.0 0.0 0.0 ' +
      'Rouge ' +
      '02/15/2026 12:00 02/15/2026 10:00 02/15/2026 12:00 02/15/2026 10:00 ' +
      'Flown Flight Leg M9001 AC100 YUL JFK 100.0 0.0 Y RSV Award 02/15/2026 100.0 0.0\n';
    const out = parseFlightSummaryText(synth);
    const ac100 = out.flights.find(f => f.flightNumber === 'AC0100');
    expect(ac100).toBeDefined();
    expect(ac100.fleet).toBe('rouge');
  });
});

describe('localToUtc', () => {
  it('converts YUL local time to UTC in February (EST, no DST)', () => {
    // 2026-02-25 21:28 YUL local (EST = UTC−5) → 2026-02-26 02:28 UTC
    expect(localToUtc('02/25/2026', '21:28', 'YUL')).toBe('2026-02-26T02:28:00.000Z');
  });

  it('converts DEL local time to UTC (IST = UTC+5:30, no DST)', () => {
    // 2026-02-26 21:49 DEL local (IST = UTC+5:30) → 2026-02-26 16:19 UTC
    expect(localToUtc('02/26/2026', '21:49', 'DEL')).toBe('2026-02-26T16:19:00.000Z');
  });

  it('returns null for an unknown airport', () => {
    expect(localToUtc('01/01/2026', '12:00', 'XXX')).toBeNull();
  });

  it('zero-pads single-digit hours', () => {
    expect(localToUtc('03/01/2026', '6:12', 'YUL')).toBe('2026-03-01T11:12:00.000Z');
  });
});

const febFixture = readFileSync(join(__dirname, 'fixtures/flight-summary-feb-2026.txt'), 'utf8');

describe('parseFlightSummaryText — February 2026', () => {
  const result = parseFlightSummaryText(febFixture);

  it('returns month YYYY-MM for February 2026', () => {
    expect(result.month).toBe('2026-02');
  });

  it('returns 4 rows total (2 deadhead + 2 flown)', () => {
    expect(result.flights).toHaveLength(4);
  });

  it('tags flightType correctly per row', () => {
    const types = Object.fromEntries(
      result.flights.map(f => [f.flightNumber, f.flightType])
    );
    expect(types).toEqual({
      AC0050: 'flown',
      AC0051: 'flown',
      AC0409: 'deadhead',
      AC0410: 'deadhead',
    });
  });

  it('tags every row with fleet "mainline" (Feb Rouge section is empty)', () => {
    expect(result.flights.every(f => f.fleet === 'mainline')).toBe(true);
  });

  it('captures pairing for flown rows; empty for deadhead rows', () => {
    expect(result.flights.find(f => f.flightNumber === 'AC0050').pairing).toBe('M7032');
    expect(result.flights.find(f => f.flightNumber === 'AC0409').pairing).toBe('');
  });

  it('reads block time from PDF Flt Min columns for flown rows', () => {
    const ac50 = result.flights.find(f => f.flightNumber === 'AC0050');
    const ac51 = result.flights.find(f => f.flightNumber === 'AC0051');
    // Feb fixture: AC50 cols 319.0 + 512.0 = 831; AC51 cols 642.0 + 346.0 = 988
    expect(ac50.blockMinutes).toBe(831);
    expect(ac51.blockMinutes).toBe(988);
  });

  it('returns date YYYY-MM-DD from Flt Dt for AC51 (March 1, on Feb summary)', () => {
    const ac51 = result.flights.find(f => f.flightNumber === 'AC0051');
    expect(ac51.date).toBe('2026-03-01');
  });

  it('exposes ATD and ATA as local wall-clock fields for AC50', () => {
    const ac50 = result.flights.find(f => f.flightNumber === 'AC0050');
    expect(ac50.atdLocal).toEqual({ date: '02/25/2026', time: '21:28' });
    expect(ac50.ataLocal).toEqual({ date: '02/26/2026', time: '21:49' });
  });

  it('exposes STD and STA as local wall-clock fields for AC50', () => {
    const ac50 = result.flights.find(f => f.flightNumber === 'AC0050');
    expect(ac50.stdLocal).toEqual({ date: '02/25/2026', time: '21:25' });
    expect(ac50.staLocal).toEqual({ date: '02/26/2026', time: '21:55' });
  });

  it('computes atdUtc and ataUtc for AC50', () => {
    const ac50 = result.flights.find(f => f.flightNumber === 'AC0050');
    expect(ac50.atdUtc).toBe('2026-02-26T02:28:00.000Z');  // YUL EST = UTC−5
    expect(ac50.ataUtc).toBe('2026-02-26T16:19:00.000Z');  // DEL IST = UTC+5:30
  });

  it('computes atdUtc and ataUtc for AC0409 deadhead (same TZ both ends)', () => {
    const ac409 = result.flights.find(f => f.flightNumber === 'AC0409');
    // 02/12/2026 11:10 YUL → 16:10 UTC ; 02/12/2026 12:26 YYZ → 17:26 UTC
    expect(ac409.atdUtc).toBe('2026-02-12T16:10:00.000Z');
    expect(ac409.ataUtc).toBe('2026-02-12T17:26:00.000Z');
  });

  it('exposes blockSeconds = blockMinutes × 60 for flown rows', () => {
    const ac50 = result.flights.find(f => f.flightNumber === 'AC0050');
    const ac51 = result.flights.find(f => f.flightNumber === 'AC0051');
    expect(ac50.blockSeconds).toBe(49860);  // 831 × 60
    expect(ac51.blockSeconds).toBe(59280);  // 988 × 60
  });

  it('computes deadhead blockSeconds from ATD-ATA UTC subtraction (Flt Min cols are 0)', () => {
    const ac409 = result.flights.find(f => f.flightNumber === 'AC0409');
    // ATD 02/12 11:10 YUL → ATA 02/12 12:26 YYZ (same TZ); 76 min = 4560 s
    expect(ac409.blockSeconds).toBe(4560);
    expect(ac409.blockMinutes).toBe(76);
  });

  it('exposes documentTotals.mainlineFltMinutes from the Mainline subtotal line', () => {
    expect(result.documentTotals.mainlineFltMinutes).toBe(1819);
  });

  it('returns null for documentTotals.rougeFltMinutes when Rouge section is empty', () => {
    expect(result.documentTotals.rougeFltMinutes).toBeNull();
  });

  it('returns documentTotals.grandFltMinutes as the sum of non-null section totals', () => {
    expect(result.documentTotals.grandFltMinutes).toBe(1819);
  });

  it('total flown blockSeconds is within 2 minutes of documentTotals.grandFltMinutes', () => {
    const flownSum = result.flights
      .filter(f => f.flightType === 'flown')
      .reduce((s, f) => s + f.blockSeconds, 0);
    expect(Math.abs(flownSum / 60 - result.documentTotals.grandFltMinutes)).toBeLessThan(2);
  });

  it('reports zero warnings on a clean parse', () => {
    expect(result.warnings).toEqual([]);
  });
});
