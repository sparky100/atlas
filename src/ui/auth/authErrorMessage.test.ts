import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authErrorMessage } from './authErrorMessage';

describe('authErrorMessage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps known Supabase Auth messages to plain, Atlas-authored sentences', () => {
    expect(authErrorMessage('Invalid login credentials')).toBe("That email or password doesn't match an account.");
    expect(authErrorMessage('User already registered')).toBe('An account already exists for that email — sign in instead.');
    expect(authErrorMessage('Email not confirmed')).toBe('Confirm your email first — check your inbox for the link, then sign in.');
    expect(authErrorMessage('Email rate limit exceeded')).toBe('Too many attempts — wait a few minutes and try again.');
    expect(authErrorMessage('Password should be at least 6 characters')).toBe('Choose a password with at least 6 characters.');
    expect(authErrorMessage('New password should be different from the old password.')).toBe('Choose a different password than your current one.');
    expect(authErrorMessage('Unable to validate email address: invalid format')).toBe("That doesn't look like a valid email address.");
    expect(authErrorMessage('Token has expired or is invalid')).toBe('That link has expired — request a new one.');
    expect(authErrorMessage('Failed to fetch')).toBe("Couldn't reach the server — check your connection and try again.");
  });

  it('is case-insensitive', () => {
    expect(authErrorMessage('INVALID LOGIN CREDENTIALS')).toBe("That email or password doesn't match an account.");
  });

  it('falls back to one plain generic sentence for anything unrecognised — never the raw text', () => {
    expect(authErrorMessage('pq: connection refused, some internal detail')).toBe('Something went wrong — try again.');
  });

  it('always logs the raw message to console, even the fallback case', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authErrorMessage('some raw detail');
    expect(spy).toHaveBeenCalledWith('Auth error:', 'some raw detail');
  });
});
