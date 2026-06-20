// Canadian-proportion tax calculations.
// Per ARC, Canadian proportion is time-based (time over Canadian airspace / total time).
// Distance is computed alongside for informational comparison only — it is NOT used
// for the proportion itself (per project memory: "Canadian proportion is time-based per ARC").
// Deadhead rows must be filtered before calling (per project memory: "Deadhead never counted").

import { getResidenceRule } from './residence-rules.js';

/**
 * Compute all-time Canadian-proportion summary across all flights.
 *
 * @param {Array<{totalTime?: number, canadianTime?: number}>} flights
 *   Pre-filtered flight records (DH rows already removed).
 * @returns {{ totalHours: number, canadianHours: number, canadianTimePct: string }}
 */
export function computeAllTimeSummary(flights) {
  const totalHours = flights.reduce((sum, f) => sum + (f.totalTime || 0), 0);
  const canadianHours = flights.reduce((sum, f) => sum + (f.canadianTime || 0), 0);
  // Per ARC, Canadian proportion is time-based (time over Canadian airspace / total time). Distance is shown alongside for comparison.
  const canadianTimePct = totalHours > 0 ? ((canadianHours / totalHours) * 100).toFixed(1) : 0;
  return { totalHours, canadianHours, canadianTimePct };
}

/**
 * Compute per-year Canadian-proportion fiscal summary.
 *
 * @param {Array<{date?: string, totalTime?: number, canadianTime?: number, distance?: number, canadianDistance?: number}>} flights
 *   Pre-filtered flight records (DH rows already removed).
 * @param {number} year — The fiscal/calendar year to summarize.
 * @param {string} [province] — One of PROVINCES (currently unused in the calculation; reserved for future per-province logic).
 * @returns {{
 *   year: number,
 *   flights: Array,
 *   totalHours: number,
 *   canadianHours: number,
 *   totalDistance: number,
 *   canadianDistance: number,
 *   canadianTimePct: string,
 *   canadianPct: string,
 * }}
 */
export function computeFiscalYear(flights, year, province) {
  // Validate province if provided (reserved for future per-province logic).
  if (province !== undefined) {
    getResidenceRule(province);
  }

  const flightsThisYear = flights.filter((f) => f.date && f.date.startsWith(`${year}-`));
  const yTotalHours = flightsThisYear.reduce((sum, f) => sum + (f.totalTime || 0), 0);
  const yCanadianHours = flightsThisYear.reduce((sum, f) => sum + (f.canadianTime || 0), 0);
  const yTotalDistance = flightsThisYear.reduce((sum, f) => sum + (f.distance || 0), 0);
  const yCanadianDistance = flightsThisYear.reduce((sum, f) => sum + (f.canadianDistance || 0), 0);
  const yCanadianTimePct = yTotalHours > 0 ? ((yCanadianHours / yTotalHours) * 100).toFixed(1) : 0;
  const yCanadianPct = yTotalDistance > 0 ? ((yCanadianDistance / yTotalDistance) * 100).toFixed(1) : 0;

  return {
    year,
    flights: flightsThisYear,
    totalHours: yTotalHours,
    canadianHours: yCanadianHours,
    totalDistance: yTotalDistance,
    canadianDistance: yCanadianDistance,
    canadianTimePct: yCanadianTimePct,
    canadianPct: yCanadianPct,
  };
}
