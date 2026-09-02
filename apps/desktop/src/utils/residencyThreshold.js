// 183-day residency threshold display logic, shared by the Dashboard, the
// Calendar and the Archive. Crossing the threshold of days outside Canada is
// the user's GOAL (CRA non-residency), so past it the bar celebrates (green)
// and the margin reads as a surplus ("+N") instead of a negative countdown.
//
// The CRA sojourner rule deems someone resident at 183 or more days IN
// Canada, so the goal is "everything but 182 days": 183 days outside in a
// 365-day year, 184 in a leap year. A fixed 183 celebrated "+0" in a leap
// year while 183 days remained in Canada — exactly the deemed-resident count.
export const RESIDENCY_THRESHOLD_DAYS = 183; // common-year value

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function residencyThresholdDays(year) {
  const y = Number(year);
  const yr = Number.isFinite(y) && y > 0 ? y : new Date().getFullYear();
  return (isLeapYear(yr) ? 366 : 365) - 182;
}

export function residencyProgress(outsideDays, year) {
  const threshold = residencyThresholdDays(year);
  const days = Number.isFinite(outsideDays) ? outsideDays : 0;
  const crossed = days >= threshold;
  const pct = Math.min((days / threshold) * 100, 100);
  const margin = crossed ? `+${days - threshold}` : String(threshold - days);
  return { pct, crossed, margin, threshold };
}
