import { AIRPORTS } from '../data/airports.js';

const AIRPORT_RE = new RegExp(`\\b(${Object.keys(AIRPORTS).join('|')})\\b`, 'g');

const PATTERNS = [
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replacement: '[EMAIL]' },
  { re: /\bya29\.[\w.-]+/g, replacement: '[TOKEN]' },
  { re: /\bBearer\s+\S+/gi, replacement: '[TOKEN]' },
  { re: /\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?/g, replacement: '[DATE]' },
  { re: /\b[A-Z]{2,3}\d{2,4}[A-Z]?\b/g, replacement: '[FLIGHT]' },
  { re: AIRPORT_RE, replacement: '[APT]' },
];

export function scrub(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  let out = value;
  for (const { re, replacement } of PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

// Recursively scrub every string inside an arbitrary value (objects, arrays,
// nested). Non-strings pass through; structure is preserved. Used for Sentry
// breadcrumb `data` and `event.extra`, which can carry logged domain objects
// or a React componentStack (audit D5/D6).
// Assumes acyclic input (Sentry payloads are) — a cycle would recurse forever.
export function scrubDeep(value) {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v);
    return out;
  }
  return value;
}

export function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (typeof event.message === 'string') {
    event.message = scrub(event.message);
  }

  if (event.exception?.values) {
    for (const v of event.exception.values) {
      if (typeof v?.value === 'string') v.value = scrub(v.value);
    }
  }

  if (Array.isArray(event.breadcrumbs)) {
    for (const b of event.breadcrumbs) {
      if (typeof b?.message === 'string') b.message = scrub(b.message);
      if (b?.data && typeof b.data === 'object') {
        b.data = scrubDeep(b.data);
      }
    }
  }

  if (event.request) {
    if (typeof event.request.url === 'string') event.request.url = scrub(event.request.url);
    if (typeof event.request.query_string === 'string') event.request.query_string = scrub(event.request.query_string);
  }

  // event.extra carries the ErrorBoundary componentStack (and anything else
  // attached later) — deep-scrub it. contexts/tags/user remain unwalked; if you
  // add PII there, extend this (audit D6).
  if (event.extra && typeof event.extra === 'object') {
    event.extra = scrubDeep(event.extra);
  }
  return event;
}
