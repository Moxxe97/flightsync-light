// Vitest setup: in Node.js 25+ the native localStorage getter lives on
// globalThis and shadows jsdom's window.localStorage. Re-point globalThis
// to jsdom's implementation so tests see the full Web Storage API.
if (typeof window !== 'undefined' && window._localStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => window._localStorage,
    configurable: true,
  });
}
if (typeof window !== 'undefined' && window._sessionStorage) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    get: () => window._sessionStorage,
    configurable: true,
  });
}
