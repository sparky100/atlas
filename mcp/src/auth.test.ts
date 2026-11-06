import { describe, expect, it } from 'vitest';
import { ensureSignedIn, NOT_SIGNED_IN, signIn, type AuthApi } from './auth';

const user = { id: 'u1', email: 'ada@example.test' };
function fakeAuth(over: Partial<AuthApi> = {}): AuthApi & { signInCalls: () => number } {
  let calls = 0;
  return {
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    signInWithPassword: () => {
      calls += 1;
      return Promise.resolve({ data: { session: { user } }, error: null });
    },
    signOut: () => Promise.resolve({ error: null }),
    ...over,
    signInCalls: () => calls,
  };
}

describe('ensureSignedIn', () => {
  it('uses the saved session and does not sign in again', async () => {
    const auth = fakeAuth({ getSession: () => Promise.resolve({ data: { session: { user } }, error: null }) });
    const r = await ensureSignedIn(auth, { email: 'x@y.z', password: 'pw' });
    expect(r).toEqual({ ok: true, user: { userId: 'u1', email: 'ada@example.test' } });
    expect(auth.signInCalls()).toBe(0);
  });

  it('signs in from the extension settings when there is no saved session', async () => {
    const auth = fakeAuth();
    const r = await ensureSignedIn(auth, { email: 'ada@example.test', password: 'pw' });
    expect(r.ok).toBe(true);
    expect(auth.signInCalls()).toBe(1);
  });

  it('tells the person how to sign in when there is nothing to sign in with', async () => {
    const r = await ensureSignedIn(fakeAuth(), { email: null, password: null });
    expect(r).toEqual({ ok: false, message: NOT_SIGNED_IN });
  });
});

describe('signIn', () => {
  it('explains a wrong password, an unconfirmed email and a network failure in plain words', async () => {
    const wrong = await signIn(fakeAuth({ signInWithPassword: () => Promise.resolve({ data: { session: null }, error: { message: 'Invalid login credentials' } }) }), 'a@b.c', 'x');
    expect(!wrong.ok && wrong.message).toMatch(/Forgot password/);
    const unconfirmed = await signIn(fakeAuth({ signInWithPassword: () => Promise.resolve({ data: { session: null }, error: { message: 'Email not confirmed' } }) }), 'a@b.c', 'x');
    expect(!unconfirmed.ok && unconfirmed.message).toMatch(/confirmation email/);
    const offline = await signIn(fakeAuth({ signInWithPassword: () => Promise.reject(new Error('fetch failed')) }), 'a@b.c', 'x');
    expect(!offline.ok && offline.message).toMatch(/Could not reach Atlas/);
  });

  it('never echoes the password in a message', async () => {
    const r = await signIn(fakeAuth({ signInWithPassword: () => Promise.resolve({ data: { session: null }, error: { message: 'something odd' } }) }), 'a@b.c', 'hunter2');
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });
});
