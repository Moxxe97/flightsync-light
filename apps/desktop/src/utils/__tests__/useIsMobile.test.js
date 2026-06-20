import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useIsMobile } from '../useIsMobile.js';

function mockMatchMedia(initialMatches) {
  let listener = null;
  const mql = {
    matches: initialMatches,
    addEventListener: (_e, cb) => { listener = cb; },
    removeEventListener: () => { listener = null; },
  };
  window.matchMedia = vi.fn(() => mql);
  return {
    setMatches(v) { mql.matches = v; if (listener) act(() => listener({ matches: v })); },
  };
}

describe('useIsMobile', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('returns true when the phone media query matches at mount', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns false when the query does not match', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('updates when the viewport crosses the breakpoint', () => {
    const ctl = mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    ctl.setMatches(true);
    expect(result.current).toBe(true);
  });
});
