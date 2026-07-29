import { describe, it, expect } from 'vitest';
import { reversedClientScheme, buildMobileAuthUrl, parseOAuthRedirect } from '../cloudAuth';

describe('reversedClientScheme', () => {
  it('reverses a Google client id into the custom scheme', () => {
    expect(reversedClientScheme('12345-abc.apps.googleusercontent.com'))
      .toBe('com.googleusercontent.apps.12345-abc');
  });
});

describe('buildMobileAuthUrl', () => {
  it('uses the reversed-scheme redirect and no client secret', () => {
    const url = new URL(buildMobileAuthUrl('12345-abc.apps.googleusercontent.com', 'CHAL', 'STATE'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const p = url.searchParams;
    expect(p.get('client_id')).toBe('12345-abc.apps.googleusercontent.com');
    expect(p.get('redirect_uri')).toBe('com.googleusercontent.apps.12345-abc:/oauth2redirect');
    expect(p.get('code_challenge')).toBe('CHAL');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('state')).toBe('STATE');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toContain('drive.file');
    expect(p.get('prompt')).toBe('consent');
    expect([...p.keys()]).not.toContain('client_secret');
  });
});

describe('parseOAuthRedirect', () => {
  it('extracts code and state from a deep-link URL', () => {
    expect(parseOAuthRedirect('com.googleusercontent.apps.12345-abc:/oauth2redirect?code=C&state=S'))
      .toEqual({ code: 'C', state: 'S', error: null });
  });
  it('extracts an error param', () => {
    expect(parseOAuthRedirect('com.googleusercontent.apps.x:/oauth2redirect?error=access_denied').error)
      .toBe('access_denied');
  });
  it('is null-safe on garbage', () => {
    expect(parseOAuthRedirect(undefined)).toEqual({ code: null, state: null, error: null });
  });
});
