import { describe, it, expect } from 'vitest';
import { estimateRoute } from '../../src/geo/route-average.js';

const yulDelHistory = [
  { departure: 'YUL', arrival: 'DEL', distance: 6080, canadianDistance: 880 },
  { departure: 'YUL', arrival: 'DEL', distance: 6090, canadianDistance: 878 },
  { departure: 'YUL', arrival: 'DEL', distance: 6075, canadianDistance: 882 },
];

describe('estimateRoute', () => {
  it('returns the arithmetic mean of historical distance and canadianDistance', () => {
    const out = estimateRoute('YUL', 'DEL', yulDelHistory);
    expect(out.source).toBe('history-avg');
    expect(out.distance).toBe(6082); // round(mean(6080,6090,6075))
    expect(out.canadianDistance).toBe(880); // round(mean(880,878,882))
  });

  it('falls back to great-circle when no history exists', () => {
    const out = estimateRoute('YUL', 'CDG', []);
    expect(out.source).toBe('great-circle');
    expect(out.distance).toBeGreaterThan(2900);
    expect(out.distance).toBeLessThan(3100);
    expect(out.canadianDistance).toBeGreaterThan(0);
    expect(out.canadianDistance).toBeLessThan(out.distance);
  });

  it('returns unknown when no history and airport is missing from coords table', () => {
    const out = estimateRoute('YUL', 'XYZ', []);
    expect(out.source).toBe('unknown');
    expect(out.distance).toBe(0);
    expect(out.canadianDistance).toBe(0);
  });

  it('ignores history entries for a different route', () => {
    const mixedHistory = [
      { departure: 'YUL', arrival: 'DEL', distance: 6080, canadianDistance: 880 },
      { departure: 'YUL', arrival: 'LHR', distance: 3000, canadianDistance: 600 },
    ];
    const out = estimateRoute('YUL', 'DEL', mixedHistory);
    expect(out.distance).toBe(6080);
    expect(out.canadianDistance).toBe(880);
  });

  it('treats history entries with zero or missing distance as unusable', () => {
    const badHistory = [
      { departure: 'YUL', arrival: 'DEL', distance: 0, canadianDistance: 0 },
      { departure: 'YUL', arrival: 'DEL', distance: null, canadianDistance: null },
    ];
    const out = estimateRoute('YUL', 'DEL', badHistory);
    // Should fall back to great-circle since no usable history
    expect(out.source).toBe('great-circle');
  });
});
