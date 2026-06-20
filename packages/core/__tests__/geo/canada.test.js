import { describe, it, expect } from 'vitest';
import { isInCanada, CANADIAN_IATA } from '../../src/geo/canada.js';

describe('CANADIAN_IATA', () => {
  it('contains the expected Canadian hubs', () => {
    expect(CANADIAN_IATA.has('YUL')).toBe(true);
    expect(CANADIAN_IATA.has('YVR')).toBe(true);
    expect(CANADIAN_IATA.has('YYZ')).toBe(true);
    expect(CANADIAN_IATA.has('CDG')).toBe(false);
  });
});

describe('isInCanada', () => {
  it('returns true for Montreal', () => {
    expect(isInCanada(45.47, -73.74)).toBe(true);
  });
  it('returns true for Vancouver', () => {
    expect(isInCanada(49.19, -123.18)).toBe(true);
  });
  it('returns false for New York', () => {
    expect(isInCanada(40.64, -73.78)).toBe(false);
  });
  it('returns false for Paris', () => {
    expect(isInCanada(49.00, 2.55)).toBe(false);
  });
});
