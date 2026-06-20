// Per-province residence rules. v1: canonical Canadian provinces.
// Each rule may grow more fields later (specific tax rates, etc.); start minimal.

export const PROVINCES = Object.freeze({
  QC: 'QC', ON: 'ON', BC: 'BC', AB: 'AB', SK: 'SK', MB: 'MB',
  NB: 'NB', NS: 'NS', PE: 'PE', NL: 'NL', YT: 'YT', NT: 'NT', NU: 'NU',
});

/**
 * Returns the residence rule for a given province.
 * Currently all provinces use the same time-based ARC proportion rule.
 * Per-province tax rates / specific deductions can be added here later.
 *
 * @param {string} province — one of PROVINCES
 * @returns {{ province: string, basis: 'time' }}
 */
export function getResidenceRule(province) {
  if (!Object.values(PROVINCES).includes(province)) {
    throw new Error(`Unknown province: ${province}`);
  }
  // All provinces use time-based ARC proportion (time over Canadian airspace / total time).
  return { province, basis: 'time' };
}
