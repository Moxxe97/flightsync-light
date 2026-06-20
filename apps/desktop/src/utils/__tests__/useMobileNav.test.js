// src/utils/__tests__/useMobileNav.test.js
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useMobileNav } from '../useMobileNav.js';

describe('useMobileNav', () => {
  beforeEach(() => {
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('starts on the menu (section = null)', () => {
    const { result } = renderHook(() => useMobileNav());
    expect(result.current.section).toBeNull();
  });

  it('open(id) sets the section and pushes a history entry', () => {
    const { result } = renderHook(() => useMobileNav());
    act(() => result.current.open('calendar'));
    expect(result.current.section).toBe('calendar');
    expect(window.history.pushState).toHaveBeenCalledWith({ section: 'calendar' }, '');
  });

  it('back() delegates to history.back()', () => {
    const { result } = renderHook(() => useMobileNav());
    act(() => result.current.open('sync'));
    act(() => result.current.back());
    expect(window.history.back).toHaveBeenCalledTimes(1);
  });

  it('a popstate event returns to the menu', () => {
    const { result } = renderHook(() => useMobileNav());
    act(() => result.current.open('data'));
    expect(result.current.section).toBe('data');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(result.current.section).toBeNull();
  });
});
