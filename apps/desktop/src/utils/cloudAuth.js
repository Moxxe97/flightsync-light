// FlightSync Light — Google sign-in via authorization-code + PKCE on the
// Tauri loopback listener (127.0.0.1:8765). No third-party auth backend. The
// refresh token lives in the macOS Keychain (Rust `keyring` commands); access tokens stay
// in memory. Profile (email/name/sub) persists in localStorage so the UI
// knows who is signed in across launches without a network call.
import { invoke } from '@tauri-apps/api/core';
import { getPlatform } from './platform';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from '../config';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const PROFILE_KEY = 'fsl-google-profile';

let _accessToken = null;
let _accessTokenExpiresAt = 0; // epoch ms
const _listeners = new Set();

export function base64UrlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomUrlSafe(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr).slice(0, len);
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

// Decode a JWT payload without verifying the signature — the id_token comes
// straight from Google's token endpoint over TLS in direct response to our
// PKCE exchange, so its origin is already authenticated by the channel.
export function decodeJwtClaims(idToken) {
  try {
    const payload = String(idToken).split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

export function buildAuthUrl(port, challenge, state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `http://127.0.0.1:${port}`,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on re-consent
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// '12345-abc.apps.googleusercontent.com' → 'com.googleusercontent.apps.12345-abc'
export function reversedClientScheme(clientId) {
  return `com.googleusercontent.apps.${String(clientId).replace(/\.apps\.googleusercontent\.com$/, '')}`;
}

export function buildMobileAuthUrl(clientId, challenge, state) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${reversedClientScheme(clientId)}:/oauth2redirect`,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    // Installed-app clients always get a refresh token, but prompt=consent
    // keeps the guarantee explicit (mirrors the desktop flow).
    prompt: 'consent',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// Deep-link redirect → {code, state, error}. Never throws.
export function parseOAuthRedirect(url) {
  try {
    const q = String(url ?? '').split('?')[1] || '';
    const p = new URLSearchParams(q);
    return { code: p.get('code'), state: p.get('state'), error: p.get('error') };
  } catch {
    return { code: null, state: null, error: null };
  }
}

function requireConfig() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Configuration Google manquante (config.js)');
  }
}

// The refresh token stored on a device was always minted by that device's own
// client, so refresh/exchange must use the matching client credentials.
// Desktop-app clients carry a (non-confidential) secret; mobile clients have none.
async function clientParams() {
  const p = await getPlatform();
  if (p === 'android') return { client_id: GOOGLE_ANDROID_CLIENT_ID };
  if (p === 'ios') return { client_id: GOOGLE_IOS_CLIENT_ID };
  return { client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET };
}

async function requireConfigForPlatform() {
  const params = await clientParams();
  if (!params.client_id) throw new Error('Missing Google client configuration (config.js)');
  return params;
}

async function tokenRequest(bodyParams) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(bodyParams).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Google token: ${data.error || res.status}`);
    err.code = data.error;
    throw err;
  }
  return data;
}

function cacheAccessToken(data) {
  _accessToken = data.access_token;
  _accessTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
}

function setProfile(profile) {
  if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  else localStorage.removeItem(PROFILE_KEY);
  for (const cb of _listeners) cb(profile);
}

export function getProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null;
  } catch {
    return null;
  }
}

// Subscribe to sign-in/out. Fires immediately with the current profile so
// App.jsx's existing `onAuthChanged((user) => setAuthUser(user))` keeps working.
export function onAuthChanged(callback) {
  _listeners.add(callback);
  callback(getProfile());
  return () => _listeners.delete(callback);
}

async function signInDesktop() {
  requireConfig();
  const port = await invoke('start_oauth_listener');
  const verifier = randomUrlSafe(64);
  const challenge = await pkceChallenge(verifier);
  const state = randomUrlSafe(32);

  const codePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      delete window.__flightSyncOAuthCb;
      reject(new Error('Google sign-in timed out (5 min)'));
    }, 5 * 60 * 1000);
    window.__flightSyncOAuthCb = (payload) => {
      clearTimeout(timeout);
      delete window.__flightSyncOAuthCb;
      if (payload.error) reject(new Error(payload.error));
      // Bind the callback to the request we initiated (CSRF guard).
      else if (payload.state !== state) reject(new Error('Unexpected OAuth response (invalid state) — ignored'));
      else if (payload.code) resolve(payload.code);
      else reject(new Error('OAuth callback missing code'));
    };
  });

  await invoke('open_google_auth_window', { authUrl: buildAuthUrl(port, challenge, state) });
  const code = await codePromise;

  const data = await tokenRequest({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: `http://127.0.0.1:${port}`,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  cacheAccessToken(data);
  if (data.refresh_token) await invoke('save_refresh_token', { token: data.refresh_token });

  const claims = decodeJwtClaims(data.id_token) || {};
  const profile = { uid: claims.sub || '', email: claims.email || '', name: claims.name || '' };
  setProfile(profile);
  return profile;
}

async function signInMobile() {
  const { client_id } = await requireConfigForPlatform();
  const verifier = randomUrlSafe(64);
  const challenge = await pkceChallenge(verifier);
  const state = randomUrlSafe(32);
  const redirectUri = `${reversedClientScheme(client_id)}:/oauth2redirect`;

  const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  const { openUrl } = await import('@tauri-apps/plugin-opener');

  const codePromise = new Promise((resolve, reject) => {
    let unlisten = null;
    const timeout = setTimeout(() => {
      unlisten?.();
      reject(new Error('Google sign-in timed out (5 min)'));
    }, 5 * 60 * 1000);
    onOpenUrl((urls) => {
      const payload = parseOAuthRedirect(urls?.[0]);
      clearTimeout(timeout);
      unlisten?.();
      if (payload.error) reject(new Error(payload.error));
      else if (payload.state !== state) reject(new Error('Unexpected OAuth response (invalid state) — ignored'));
      else if (payload.code) resolve(payload.code);
      else reject(new Error('OAuth callback missing code'));
    }).then(
      (fn) => { unlisten = fn; },
      (err) => { clearTimeout(timeout); reject(err); },
    );
  });

  // System browser, never an embedded webview — Google rejects webview OAuth.
  await openUrl(buildMobileAuthUrl(client_id, challenge, state));
  const code = await codePromise;

  const data = await tokenRequest({
    code,
    client_id,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  cacheAccessToken(data);
  if (data.refresh_token) await invoke('save_refresh_token', { token: data.refresh_token });

  const claims = decodeJwtClaims(data.id_token) || {};
  const profile = { uid: claims.sub || '', email: claims.email || '', name: claims.name || '' };
  setProfile(profile);
  return profile;
}

export async function signInWithGoogle() {
  const p = await getPlatform();
  return p === 'desktop' ? signInDesktop() : signInMobile();
}

// Returns a valid access token, silently refreshing via the Keychain refresh
// token. Returns null when signed out. Throws 'reconnection required' when the
// refresh token was revoked (the UI shows the sign-in button again).
export async function ensureAccessToken() {
  if (_accessToken && Date.now() < _accessTokenExpiresAt) return _accessToken;
  const refreshToken = await invoke('load_refresh_token');
  if (!refreshToken) return null;
  const params = await requireConfigForPlatform();
  try {
    const data = await tokenRequest({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      ...params,
    });
    cacheAccessToken(data);
    return _accessToken;
  } catch (err) {
    if (err.code === 'invalid_grant') {
      // Token revoked from the Google account side: forget it and sign out locally.
      await invoke('delete_refresh_token');
      _accessToken = null;
      setProfile(null);
      throw new Error('reconnection required');
    }
    throw err;
  }
}

export async function signOut() {
  const refreshToken = await invoke('load_refresh_token');
  if (refreshToken) {
    // Best-effort revoke; local sign-out proceeds even offline.
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' });
    } catch { /* offline — keychain delete below still signs us out locally */ }
  }
  await invoke('delete_refresh_token');
  _accessToken = null;
  _accessTokenExpiresAt = 0;
  setProfile(null);
}
