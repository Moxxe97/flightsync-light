import { describe, it, expect, vi, beforeEach } from 'vitest';
import { base64UrlEncode, decodeJwtClaims, buildAuthUrl } from '../cloudAuth';

describe('base64UrlEncode', () => {
  it('encodes without padding, +, or /', () => {
    const bytes = new Uint8Array([251, 255, 190, 0, 1]);
    const s = base64UrlEncode(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(s.length).toBeGreaterThan(0);
  });
});

describe('decodeJwtClaims', () => {
  it('decodes payload claims', () => {
    const payload = btoa(JSON.stringify({ email: 'p@x.ca', name: 'P', sub: '42' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwt = `eyJhbGciOiJub25lIn0.${payload}.sig`;
    expect(decodeJwtClaims(jwt)).toMatchObject({ email: 'p@x.ca', sub: '42' });
  });
  it('returns null on garbage', () => {
    expect(decodeJwtClaims('not-a-jwt')).toBeNull();
  });
});

describe('buildAuthUrl', () => {
  it('requests code flow with PKCE, offline access, and Light scopes only', () => {
    const url = new URL(buildAuthUrl(8765, 'CHALL', 'STATE'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge')).toBe('CHALL');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('STATE');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8765');
    const scope = url.searchParams.get('scope');
    expect(scope).toContain('drive.file');
    expect(scope).not.toContain('calendar'); // GCal integration removed 2026-06-12
    expect(scope).not.toContain('drive.readonly'); // restricted scope — banned in Light
  });
});

describe('ensureAccessToken', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null when no refresh token is stored (signed out)', async () => {
    // vi.doMock is not hoisted — safe to call inside a test body.
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));
    vi.doMock('../../config', () => ({
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
    }));
    const { ensureAccessToken } = await import('../cloudAuth');
    await expect(ensureAccessToken()).resolves.toBeNull();
  });

  it('throws "reconnexion requise" and deletes the refresh token on invalid_grant', async () => {
    const invokeMock = vi.fn(async (cmd) => {
      if (cmd === 'load_refresh_token') return 'stored-token';
      return null; // delete_refresh_token + anything else
    });
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('../../config', () => ({
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
    }));
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    }));
    const { ensureAccessToken } = await import('../cloudAuth');
    await expect(ensureAccessToken()).rejects.toThrow('reconnexion requise');
    expect(invokeMock).toHaveBeenCalledWith('delete_refresh_token');
  });
});
