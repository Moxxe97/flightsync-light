// Coverage for the mobile deep-link PKCE sign-in path (signInMobile) and the
// platform-dispatching signInWithGoogle(). Pure-helper coverage (reversedClientScheme,
// buildMobileAuthUrl, parseOAuthRedirect) already lives in cloudAuth.mobile.test.js —
// this file covers the flow itself (Task 3 review follow-up).
//
// Mirrors the mocking pattern in cloudAuth.test.js: vi.doMock (not hoisted) + a
// fresh dynamic import per test after vi.resetModules(), since the mocked
// '@tauri-apps/api/core' / '../../config' / plugin modules must be in place
// before cloudAuth (and its own dynamic plugin imports) are (re-)loaded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ANDROID_CLIENT_ID = '111111-android.apps.googleusercontent.com';

function makeIdToken(claims) {
  const payload = btoa(JSON.stringify(claims))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

function mockConfig(overrides = {}) {
  vi.doMock('../../config', () => ({
    GOOGLE_CLIENT_ID: 'desktop-client-id',
    GOOGLE_CLIENT_SECRET: 'desktop-client-secret',
    GOOGLE_ANDROID_CLIENT_ID: ANDROID_CLIENT_ID,
    GOOGLE_IOS_CLIENT_ID: '',
    ...overrides,
  }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe('signInWithGoogle platform dispatch', () => {
  // Both flows arm a 5-min setTimeout as soon as they start. These tests only
  // assert on which branch was taken (not on the full round trip), so nothing
  // ever resolves that timer — spy on setTimeout and clear whatever it created
  // once the assertions are done, so no fake/real timer is left dangling past
  // the test (and no 5-minute real wait is required).
  let setTimeoutSpy;
  beforeEach(() => {
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
  });
  afterEach(() => {
    setTimeoutSpy.mock.results.forEach((r) => { if (r.type === 'return') clearTimeout(r.value); });
    setTimeoutSpy.mockRestore();
  });

  it('dispatches to the mobile flow (system browser, no loopback listener) on android', async () => {
    const invokeMock = vi.fn(async (cmd) => {
      if (cmd === 'platform_name') return 'android';
      return null;
    });
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    mockConfig();
    const openUrl = vi.fn(async () => {});
    const onOpenUrl = vi.fn(async () => () => {});
    vi.doMock('@tauri-apps/plugin-opener', () => ({ openUrl }));
    vi.doMock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl }));

    const { signInWithGoogle } = await import('../cloudAuth');
    const result = signInWithGoogle();
    result.catch(() => {}); // left pending on purpose — its timer is cleared in afterEach

    await vi.waitFor(() => expect(openUrl).toHaveBeenCalled());

    expect(onOpenUrl).toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith('start_oauth_listener');
    expect(invokeMock).not.toHaveBeenCalledWith('open_google_auth_window', expect.anything());
  });

  it('dispatches to the desktop loopback flow on desktop', async () => {
    const invokeMock = vi.fn(async (cmd) => {
      if (cmd === 'platform_name') return 'desktop';
      if (cmd === 'start_oauth_listener') return 8765;
      return null;
    });
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    mockConfig();
    const openUrl = vi.fn(async () => {});
    const onOpenUrl = vi.fn(async () => () => {});
    vi.doMock('@tauri-apps/plugin-opener', () => ({ openUrl }));
    vi.doMock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl }));

    const { signInWithGoogle } = await import('../cloudAuth');
    const result = signInWithGoogle();
    result.catch(() => {}); // left pending on purpose — its timer is cleared in afterEach

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('open_google_auth_window', expect.anything()));

    expect(invokeMock).toHaveBeenCalledWith('start_oauth_listener');
    expect(openUrl).not.toHaveBeenCalled();
    expect(onOpenUrl).not.toHaveBeenCalled();
  });
});

describe('signInMobile', () => {
  it('happy path: resolves the profile, saves the refresh token, and sends no client_secret', async () => {
    const invokeMock = vi.fn(async (cmd) => {
      if (cmd === 'platform_name') return 'android';
      return null;
    });
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    mockConfig();

    let capturedAuthUrl = null;
    const openUrl = vi.fn(async (url) => { capturedAuthUrl = url; });
    let capturedCb = null;
    const onOpenUrl = vi.fn(async (cb) => { capturedCb = cb; return () => {}; });
    vi.doMock('@tauri-apps/plugin-opener', () => ({ openUrl }));
    vi.doMock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl }));

    const idToken = makeIdToken({ sub: 'uid-42', email: 'pilot@example.com', name: 'Pilot' });
    let capturedFetchBody = null;
    globalThis.fetch = vi.fn(async (_url, opts) => {
      capturedFetchBody = opts.body;
      return {
        ok: true,
        json: async () => ({
          access_token: 'ACCESS-TOKEN',
          expires_in: 3600,
          id_token: idToken,
          refresh_token: 'REFRESH-TOKEN',
        }),
      };
    });

    const { signInWithGoogle } = await import('../cloudAuth');
    const resultPromise = signInWithGoogle();

    await vi.waitFor(() => expect(openUrl).toHaveBeenCalled());
    expect(capturedCb).toBeInstanceOf(Function);

    const state = new URL(capturedAuthUrl).searchParams.get('state');
    expect(state).toBeTruthy();

    capturedCb([
      `com.googleusercontent.apps.111111-android:/oauth2redirect?code=AUTHCODE&state=${state}`,
    ]);

    const profile = await resultPromise;
    expect(profile).toEqual({ uid: 'uid-42', email: 'pilot@example.com', name: 'Pilot' });

    expect(invokeMock).toHaveBeenCalledWith('save_refresh_token', { token: 'REFRESH-TOKEN' });

    // No client_secret anywhere in the mobile token exchange body.
    const body = new URLSearchParams(capturedFetchBody);
    expect(body.has('client_secret')).toBe(false);
    expect(body.get('client_id')).toBe(ANDROID_CLIENT_ID);
    expect(body.get('code')).toBe('AUTHCODE');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBeTruthy();
  });

  it('rejects on a state mismatch (CSRF guard) without resolving', async () => {
    const invokeMock = vi.fn(async (cmd) => (cmd === 'platform_name' ? 'android' : null));
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    mockConfig();

    const openUrl = vi.fn(async () => {});
    let capturedCb = null;
    const onOpenUrl = vi.fn(async (cb) => { capturedCb = cb; return () => {}; });
    vi.doMock('@tauri-apps/plugin-opener', () => ({ openUrl }));
    vi.doMock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl }));
    globalThis.fetch = vi.fn(); // must not be reached

    const { signInWithGoogle } = await import('../cloudAuth');
    const resultPromise = signInWithGoogle();

    await vi.waitFor(() => expect(openUrl).toHaveBeenCalled());

    capturedCb([
      'com.googleusercontent.apps.111111-android:/oauth2redirect?code=AUTHCODE&state=WRONG-STATE',
    ]);

    await expect(resultPromise).rejects.toThrow('Unexpected OAuth response (invalid state) — ignored');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects when the redirect carries an OAuth error param', async () => {
    const invokeMock = vi.fn(async (cmd) => (cmd === 'platform_name' ? 'android' : null));
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
    mockConfig();

    let capturedAuthUrl = null;
    const openUrl = vi.fn(async (url) => { capturedAuthUrl = url; });
    let capturedCb = null;
    const onOpenUrl = vi.fn(async (cb) => { capturedCb = cb; return () => {}; });
    vi.doMock('@tauri-apps/plugin-opener', () => ({ openUrl }));
    vi.doMock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl }));
    globalThis.fetch = vi.fn(); // must not be reached

    const { signInWithGoogle } = await import('../cloudAuth');
    const resultPromise = signInWithGoogle();

    await vi.waitFor(() => expect(openUrl).toHaveBeenCalled());
    const state = new URL(capturedAuthUrl).searchParams.get('state');

    capturedCb([
      `com.googleusercontent.apps.111111-android:/oauth2redirect?error=access_denied&state=${state}`,
    ]);

    await expect(resultPromise).rejects.toThrow('access_denied');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
