import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOfp } from '../../src/parsing/ofp.js';

// First direct coverage of the raw-OFP-text path (parseWaypointsFromOFP via parseOfp).
// Fixtures are synthetic AC Smart4Aviation flight logs whose per-leg DIS column
// equals the great-circle distance between consecutive fixes (realistic: adjacent
// plotting points are ~straight).
const here = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(here, 'fixtures', f), 'utf8');

describe('parseOfp — OFP text parsing + per-leg distance self-heal', () => {
  it('parses a clean AC OFP flight log into waypoints and a Canadian distance', () => {
    const { flights } = parseOfp(read('ofp-yul-lhr-clean.txt'));
    expect(flights).toHaveLength(1);
    const f = flights[0];
    expect(f.departure).toBe('YUL');
    expect(f.arrival).toBe('LHR');
    expect(f.canadianDistance).toBeGreaterThan(0);
    expect(f.canadianDistance).toBeLessThanOrEqual(f.distance); // capped at gcDist
    expect(f.notes).toContain('waypoints (11 fixes)');
    expect(f.notes).not.toContain('dist-corrected'); // clean legs need no correction
  });

  it('heals a mis-captured DIS column (FL emitted before the distance) back to geometry', () => {
    // The corrupt fixture injects FL380 before the real 190nm distance on the
    // F02->F03 leg (over Canada), the exact silent failure the audit measured.
    const clean = parseOfp(read('ofp-yul-lhr-clean.txt')).flights[0];
    const corrupted = parseOfp(read('ofp-yul-lhr-fl-before-dis.txt')).flights[0];
    // Without the heal the bogus 380nm leg inflates canadianDistance; the heal
    // replaces it with the great-circle distance between the two fixes (=190),
    // restoring the clean value, and records that a leg was corrected.
    expect(corrupted.canadianDistance).toBe(clean.canadianDistance);
    expect(corrupted.notes).toContain('dist-corrected');
  });
});
