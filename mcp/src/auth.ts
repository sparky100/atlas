/**
 * ADR-029 §2: signing in as the user, with plain messages for every way it
 * can fail. The Supabase client is passed in (and only its `auth` part is
 * used), so this is tested with a fake.
 */
export interface AuthApi {
  getSession: () => Promise<{ data: { session: { user: { id: string; email?: string | undefined } } | null }; error: { message: string } | null }>;
  signInWithPassword: (credentials: { email: string; password: string }) => Promise<{ data: { session: { user: { id: string; email?: string | undefined } } | null }; error: { message: string } | null }>;
  signOut: () => Promise<{ error: { message: string } | null }>;
}

export interface SignedIn {
  userId: string;
  email: string | null;
}

export type SignInResult = { ok: true; user: SignedIn } | { ok: false; message: string };

export const NOT_SIGNED_IN = 'You are not signed in to Atlas. Run `atlas-mcp login` in a terminal (or set your email and password in the extension settings), then try again.';

function describeSignInError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return 'Atlas did not accept that email and password. If you normally sign in with an emailed link, set a password first with "Forgot password" on the Atlas sign-in page.';
  }
  if (/email not confirmed/i.test(message)) return 'That email address has not been confirmed yet. Open the confirmation email from Atlas first.';
  if (/fetch|network|ENOTFOUND|ECONN|timed out/i.test(message)) return 'Could not reach Atlas. Check your internet connection and try again.';
  return `Atlas could not sign you in: ${message}`;
}

/** The stored session if there is one (Supabase refreshes it if needed); otherwise sign in with the given email and password if both are present. */
export async function ensureSignedIn(auth: AuthApi, credentials: { email: string | null; password: string | null }): Promise<SignInResult> {
  const existing = await auth.getSession();
  const stored = existing.data.session;
  if (stored) return { ok: true, user: { userId: stored.user.id, email: stored.user.email ?? null } };

  if (credentials.email === null || credentials.password === null) return { ok: false, message: NOT_SIGNED_IN };
  return signIn(auth, credentials.email, credentials.password);
}

export async function signIn(auth: AuthApi, email: string, password: string): Promise<SignInResult> {
  let result: Awaited<ReturnType<AuthApi['signInWithPassword']>>;
  try {
    result = await auth.signInWithPassword({ email, password });
  } catch (e) {
    return { ok: false, message: describeSignInError(e instanceof Error ? e.message : String(e)) };
  }
  if (result.error) return { ok: false, message: describeSignInError(result.error.message) };
  const session = result.data.session;
  if (!session) return { ok: false, message: 'Atlas did not return a session. Try again.' };
  return { ok: true, user: { userId: session.user.id, email: session.user.email ?? email } };
}
