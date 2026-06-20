import { describe, it, expect } from 'vitest';
import { parseOfp } from '../../src/parsing/ofp.js';

// Re-importing the same OFP must produce the SAME flight id, so an "update"
// replaces the existing Firestore doc in place instead of orphaning it and
// resurrecting a duplicate flight (which double-counts CRA hours). The id must
// therefore be a pure function of the OFP content, not embed Date.now().
describe('parseOfp — deterministic flight id', () => {
  const text = 'CYUL/YUL - CYYZ/YYZ\nAC0123 01JAN2026\nBLOCK TIME 1.20';

  it('produces the same id for the same OFP text across calls', () => {
    const a = parseOfp(text);
    const b = parseOfp(text);
    expect(a.flights).toHaveLength(1);
    expect(b.flights).toHaveLength(1);
    expect(a.flights[0].id).toBe(b.flights[0].id);
  });

  it('id does not embed a wall-clock timestamp', () => {
    const { flights } = parseOfp(text);
    // pdf-AC0123-2026-01-01-0 — date + index only, no 13-digit epoch ms.
    expect(flights[0].id).toBe('pdf-AC0123-2026-01-01-0');
    expect(flights[0].id).not.toMatch(/\d{13}/);
  });
});

describe('parseOfp leg cap (audit #25/G4)', () => {
  it('caps a crafted PDF at 8 legs and returns a warning', () => {
    const nums = Array.from({ length: 20 }, (_, i) => `AC${String(i + 1).padStart(4, '0')}`);
    const text = `OFP ${nums.join(' ')} YUL CDG`;
    const result = parseOfp(text);
    expect(result.flights.length).toBeLessThanOrEqual(8);
    expect(result.warning).toMatch(/limité/);
  });
  it('does not warn at or below 8 legs', () => {
    const result = parseOfp('OFP AC0001 AC0002 YUL CDG');
    expect(result.warning).toBeUndefined();
  });
});
