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
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(async (cmd) => (cmd === 'platform_name' ? 'desktop' : null)),
    }));
    vi.doMock('../../config', () => ({
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_ANDROID_CLIENT_ID: '',
      GOOGLE_IOS_CLIENT_ID: '',
    }));
    const { ensureAccessToken } = await import('../cloudAuth');
    await expect(ensureAccessToken()).resolves.toBeNull();
  });

  it('throws "reconnection required" and deletes the refresh token on invalid_grant', async () => {
    const invokeMock = vi.fn(async (cmd) => {
      if (cmd === 'load_refresh_token') return 'stored-token';
      if (cmd === 'platform_name') return 'desktop';
      return null; // delete_refresh_token + anything else
    });
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('../../config', () => ({
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_ANDROID_CLIENT_ID: '',
      GOOGLE_IOS_CLIENT_ID: '',
    }));
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    }));
    const { ensureAccessToken } = await import('../cloudAuth');
    await expect(ensureAccessToken()).rejects.toThrow('reconnection required');
    expect(invokeMock).toHaveBeenCalledWith('delete_refresh_token');
  });

  // A new phone restored from a backup (or a Mac whose Keychain item is gone)
  // keeps the stored profile but has no refresh token: the app said "Signed in"
  // while every backup failed with "Not signed in". Show the sign-in button.
  it('clears a stale signed-in profile when the token store holds no token', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(async (cmd) => (cmd === 'platform_name' ? 'android' : null)),
    }));
    vi.doMock('../../config', () => ({
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_ANDROID_CLIENT_ID: 'android-client-id',
      GOOGLE_IOS_CLIENT_ID: '',
    }));
    localStorage.setItem('fsl-google-profile', JSON.stringify({ uid: 'u1', email: 'pilot@example.com' }));
    const { ensureAccessToken, getProfile, onAuthChanged } = await import('../cloudAuth');
    const seen = [];
    onAuthChanged((p) => seen.push(p));
    await expect(ensureAccessToken()).resolves.toBeNull();
    expect(getProfile()).toBeNull();
    expect(seen.at(-1)).toBeNull();
  });

  it('keeps the profile when reading the token store fails (an error is not "no token")', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(async (cmd) => {
        if (cmd === 'platform_name') return 'desktop';
        throw new Error('User canceled the Keychain prompt');
      }),
    }));
    vi.doMock('../../config', () => ({
      GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_ANDROID_CLIENT_ID: '', GOOGLE_IOS_CLIENT_ID: '',
    }));
    localStorage.setItem('fsl-google-profile', JSON.stringify({ uid: 'u1', email: 'pilot@example.com' }));
    const { ensureAccessToken, getProfile } = await import('../cloudAuth');
    await expect(ensureAccessToken()).rejects.toThrow(/Keychain/);
    expect(getProfile()).toEqual({ uid: 'u1', email: 'pilot@example.com' });
  });
});

describe('signOut', () => {
  beforeEach(() => { vi.resetModules(); });

  // Android: an encrypted token file restored onto a new phone cannot be
  // decrypted, so load/delete threw and Sign out failed — the pilot could
  // neither sign out nor back in. Signing out locally must always complete.
  it('signs out locally even when the token store cannot be read', async () => {
    const invokeMock = vi.fn(async (cmd) => {
      if (cmd === 'platform_name') return 'android';
      if (cmd === 'load_refresh_token') throw new Error('javax.crypto.AEADBadTagException');
      return null;
    });
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    vi.doMock('../../config', () => ({
      GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', GOOGLE_ANDROID_CLIENT_ID: 'a', GOOGLE_IOS_CLIENT_ID: '',
    }));
    globalThis.fetch = vi.fn();
    localStorage.setItem('fsl-google-profile', JSON.stringify({ uid: 'u1', email: 'pilot@example.com' }));
    const { signOut, getProfile } = await import('../cloudAuth');
    await expect(signOut()).resolves.toBeUndefined();
    expect(getProfile()).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith('delete_refresh_token');
  });
});
