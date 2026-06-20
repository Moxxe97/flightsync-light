import { describe, it, expect } from 'vitest';
import { scrub, scrubEvent, scrubDeep } from '../../src/util/scrub.js';

describe('scrub() — non-string inputs', () => {
  it('returns empty string for null', () => {
    expect(scrub(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(scrub(undefined)).toBe('');
  });

  it('returns numbers unchanged', () => {
    expect(scrub(42)).toBe(42);
  });

  it('returns objects unchanged', () => {
    const o = { a: 1 };
    expect(scrub(o)).toBe(o);
  });

  it('returns plain strings unchanged when no patterns match', () => {
    expect(scrub('hello world')).toBe('hello world');
  });
});

describe('scrub() — emails', () => {
  it('redacts a basic email', () => {
    expect(scrub('contact user@example.com please')).toBe('contact [EMAIL] please');
  });

  it('redacts emails with + and . in local part', () => {
    expect(scrub('p.ilote+test@example.co.uk')).toBe('[EMAIL]');
  });
});

describe('scrub() — OAuth tokens', () => {
  it('redacts ya29 Google access tokens', () => {
    expect(scrub('token ya29.a0ARrdaM_abc-def.123 ok')).toBe('token [TOKEN] ok');
  });

  it('redacts Bearer tokens (case-insensitive)', () => {
    expect(scrub('Authorization: Bearer eyJhbGc.foo.bar')).toBe('Authorization: [TOKEN]');
    expect(scrub('bearer x.y.z')).toBe('[TOKEN]');
  });
});

describe('scrub() — dates', () => {
  it('redacts plain ISO dates', () => {
    expect(scrub('flew on 2026-05-03 from YUL')).toBe('flew on [DATE] from [APT]');
  });

  it('redacts ISO datetimes with Z', () => {
    expect(scrub('atd=2026-05-03T14:22:00Z')).toBe('atd=[DATE]');
  });

  it('redacts ISO datetimes without seconds', () => {
    expect(scrub('window 2026-05-03T14:22')).toBe('window [DATE]');
  });
});

describe('scrub() — flight numbers', () => {
  it('redacts AC123', () => {
    expect(scrub('flew AC123 yesterday')).toBe('flew [FLIGHT] yesterday');
  });

  it('redacts TS1234 (Air Transat-style 4-digit)', () => {
    expect(scrub('TS1234 was delayed')).toBe('[FLIGHT] was delayed');
  });

  it('redacts WG45A (with trailing letter)', () => {
    expect(scrub('WG45A diverted')).toBe('[FLIGHT] diverted');
  });

  it('does NOT redact lowercase or non-flight tokens', () => {
    expect(scrub('hello ac123 world')).toBe('hello ac123 world');
    expect(scrub('R2D2 droid')).toBe('R2D2 droid');
  });
});

describe('scrub() — airports', () => {
  it('redacts known IATA codes (YUL, LAX)', () => {
    expect(scrub('flew YUL to LAX')).toBe('flew [APT] to [APT]');
  });

  it('does NOT redact unknown 3-letter uppercase tokens', () => {
    expect(scrub('the FBI investigated')).toBe('the FBI investigated');
  });

  it('respects word boundaries (does not redact inside other tokens)', () => {
    expect(scrub('XYULZ is not an airport')).toBe('XYULZ is not an airport');
  });
});

describe('scrubEvent()', () => {
  it('scrubs event.message', () => {
    const e = { message: 'crashed parsing AC123' };
    expect(scrubEvent(e).message).toBe('crashed parsing [FLIGHT]');
  });

  it('scrubs each exception value', () => {
    const e = { exception: { values: [{ value: 'YUL routing' }, { value: 'user@example.com' }] } };
    const out = scrubEvent(e);
    expect(out.exception.values[0].value).toBe('[APT] routing');
    expect(out.exception.values[1].value).toBe('[EMAIL]');
  });

  it('scrubs breadcrumb messages', () => {
    const e = { breadcrumbs: [{ message: 'fetched 2026-05-03 schedule' }] };
    expect(scrubEvent(e).breadcrumbs[0].message).toBe('fetched [DATE] schedule');
  });

  it('scrubs string values inside breadcrumb.data', () => {
    const e = { breadcrumbs: [{ data: { url: 'https://x.com/?token=ya29.abc', count: 3 } }] };
    const out = scrubEvent(e);
    expect(out.breadcrumbs[0].data.url).toBe('https://x.com/?token=[TOKEN]');
    expect(out.breadcrumbs[0].data.count).toBe(3);
  });

  it('scrubs request.url and request.query_string', () => {
    const e = { request: { url: 'https://x/AC123', query_string: 'date=2026-05-03' } };
    const out = scrubEvent(e);
    expect(out.request.url).toBe('https://x/[FLIGHT]');
    expect(out.request.query_string).toBe('date=[DATE]');
  });

  it('returns the event for an empty object', () => {
    expect(scrubEvent({})).toEqual({});
  });

  it('does not throw on missing nested fields', () => {
    expect(() => scrubEvent({ exception: {} })).not.toThrow();
    expect(() => scrubEvent({ breadcrumbs: [{}] })).not.toThrow();
  });

  it('deep-scrubs nested objects/arrays inside breadcrumb.data (audit D5)', () => {
    const e = {
      breadcrumbs: [
        {
          data: {
            bp: { fileName: 'BP YUL 2026-05-01.pdf', token: 'Bearer abc' },
            list: ['ya29.secret'],
            count: 7,
          },
        },
      ],
    };
    const out = scrubEvent(e);
    const d = out.breadcrumbs[0].data;
    expect(d.bp.fileName).toBe('BP [APT] [DATE].pdf');
    expect(d.bp.token).toBe('[TOKEN]');
    expect(d.list[0]).toBe('[TOKEN]');
    expect(d.count).toBe(7);
  });

  it('deep-scrubs event.extra (componentStack from ErrorBoundary) (audit D6)', () => {
    const e = { extra: { componentStack: 'render AC871 at YUL on 2026-05-01' } };
    const out = scrubEvent(e);
    expect(out.extra.componentStack).toBe('render [FLIGHT] at [APT] on [DATE]');
  });
});

describe('scrubDeep()', () => {
  it('scrubs strings recursively while preserving non-strings and shape', () => {
    const input = {
      msg: 'flew AC123 from YUL',
      n: 42,
      ok: true,
      nada: null,
      arr: ['user@example.com', 99, { deep: 'Bearer xyz' }],
    };
    const out = scrubDeep(input);
    expect(out.msg).toBe('flew [FLIGHT] from [APT]');
    expect(out.n).toBe(42);
    expect(out.ok).toBe(true);
    expect(out.nada).toBeNull();
    expect(out.arr[0]).toBe('[EMAIL]');
    expect(out.arr[1]).toBe(99);
    expect(out.arr[2].deep).toBe('[TOKEN]');
  });

  it('passes primitive non-strings straight through', () => {
    expect(scrubDeep(5)).toBe(5);
    expect(scrubDeep(false)).toBe(false);
    expect(scrubDeep(null)).toBeNull();
    expect(scrubDeep(undefined)).toBeUndefined();
  });
});
