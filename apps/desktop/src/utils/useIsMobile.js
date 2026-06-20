import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 767px)';

function subscribe(callback) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches;
}

// True on phone-width viewports (< 768px). Reads matchMedia via an external
// store so there is no setState-inside-effect (lint-clean, tear-free).
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
