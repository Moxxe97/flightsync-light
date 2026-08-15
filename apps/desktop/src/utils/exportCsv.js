import { computeAllTimeSummary } from '@flightsync/core/tax';
import { csvEscape } from './exportEscape';

// Tax-focused CSV export: one row per flight (date-ascending) + a final TOTAL
// row. The percentage column is TIME-based (canadianTime / totalTime) per the
// ARC/CRA basis — never the distance ratio. The TOTAL row's percentage is the
// true aggregate (Σ canadian / Σ total) over the exported rows, computed with
// the same core helper as the Dashboard so the two always agree.
export function buildFlightsCsv(flights, headers) {
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const sorted = [...flights].sort((a, b) => a.date.localeCompare(b.date));
  const rows = sorted.map((f) => {
    const can = num(f.canadianTime);
    const total = num(f.totalTime);
    const pct = total > 0 ? ((can / total) * 100).toFixed(1) : '0';
    return [f.date, f.flightNumber, f.departure, f.arrival, can, total, pct].map(csvEscape);
  });
  const { totalHours, canadianHours, canadianTimePct } = computeAllTimeSummary(sorted);
  const totalRow = ['TOTAL', '', '', '', canadianHours.toFixed(1), totalHours.toFixed(1), canadianTimePct]
    .map(csvEscape);
  return [headers.join(','), ...rows.map((r) => r.join(',')), totalRow.join(',')].join('\n');
}

// CSV-import row guard: a real flight row's Date cell contains at least one
// digit (any date format) and is not the export's TOTAL line. Skips summary
// rows and text footers without constraining legitimate date formats.
export function looksLikeFlightRow(dateCell) {
  const s = String(dateCell ?? '').trim();
  return /\d/.test(s) && !/^total/i.test(s);
}
