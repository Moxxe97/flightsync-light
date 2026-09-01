// 183-day residency threshold display logic, shared by the Dashboard and
// Calendar bars. Crossing 183 days outside Canada is the user's GOAL (CRA
// non-residency), so past the threshold the bar celebrates (green) and the
// margin reads as a surplus ("+N") instead of a negative countdown.
export const RESIDENCY_THRESHOLD_DAYS = 183;

export function residencyProgress(outsideDays) {
  const days = Number.isFinite(outsideDays) ? outsideDays : 0;
  const crossed = days >= RESIDENCY_THRESHOLD_DAYS;
  const pct = Math.min((days / RESIDENCY_THRESHOLD_DAYS) * 100, 100);
  const margin = crossed
    ? `+${days - RESIDENCY_THRESHOLD_DAYS}`
    : String(RESIDENCY_THRESHOLD_DAYS - days);
  return { pct, crossed, margin };
}
