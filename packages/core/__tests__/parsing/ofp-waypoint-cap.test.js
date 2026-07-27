import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseWaypointsFromOFP, parseOfp } from '../../src/parsing/ofp.js';

// Audit finding M4: a crafted OFP with a huge number of fabricated waypoint
// rows makes parseWaypointsFromOFP do unbounded, synchronous work (unbounded
// regex-match arrays, unbounded pairing, unbounded haversine self-heal loop),
// blocking the UI thread. Mirrors the MAX_LEGS discipline already applied to
// flight numbers (ofp.js ~line 187): bound the work to a constant regardless
// of input size, without truncating any real OFP (~50-150 waypoints).
const here = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(here, 'fixtures', f), 'utf8');

const MAX_WAYPOINTS = 500;

describe('parseWaypointsFromOFP — waypoint cap (audit M4, CPU-exhaustion DoS)', () => {
  it('caps a crafted flight log with 5,000+ fabricated waypoint rows at MAX_WAYPOINTS and flags truncation', () => {
    // Single-line "lat lon dist" rows keep the fixture cheap to build while
    // still matching both latRe and lonRe independently, exactly like a real
    // row split across two PDF lines would.
    const row = 'N4528.2 W07344.5 42';
    const rows = new Array(5000).fill(row).join('\n');
    const text = `FLIGHT LOG\n${rows}`;

    const start = performance.now();
    const waypoints = parseWaypointsFromOFP(text);
    const elapsed = performance.now() - start;

    expect(waypoints.length).toBeLessThanOrEqual(MAX_WAYPOINTS);
    expect(waypoints.length).toBeGreaterThan(0);
    expect(waypoints.truncated).toBe(true);
    // Generous threshold: the cap makes this a ~ms operation; an unbounded
    // parse of 5,000 fabricated rows (and the audit's 50,000-row PoC) is far
    // slower and scales linearly with input size.
    expect(elapsed).toBeLessThan(1000);
  });

  it('leaves a normal small OFP flight log completely unaffected', () => {
    const waypoints = parseWaypointsFromOFP(read('ofp-yul-lhr-clean.txt'));
    expect(waypoints.length).toBe(11);
    expect(waypoints.truncated).toBeFalsy();
  });

  it('surfaces the truncation as a user-visible warning through parseOfp', () => {
    const row = 'N4528.2 W07344.5 42';
    const rows = new Array(5000).fill(row).join('\n');
    const text = `AC0871 / ACA871  15 JUN 2026   CYUL/YUL - EGLL/LHR\nG/C 2816   EET 0615\nBLOCK TIME   0001   0615\n\nFLIGHT LOG\n${rows}`;

    const { flights, warning } = parseOfp(text);
    expect(flights).toHaveLength(1);
    expect(warning).toBeTruthy();
    expect(flights[0].notes).toContain('truncated');
  });
});
