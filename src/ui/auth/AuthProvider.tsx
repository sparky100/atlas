import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { consumeMyInvites } from '../../db/invites';
import { supabase } from '../supabaseClient';
import { AuthContext, type AuthContextValue, type AuthStatus } from './authContext';

/**
 * Real password auth against Supabase (`supabase.auth`), no session
 * shortcut — the same auth flow src/db/repository.integration.test.ts
 * exercises server-side. Tracks the live session via
 * `onAuthStateChange` so a token refresh or a sign-out in another tab is
 * reflected here too, not just at initial load.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setStatus(session ? 'signedIn' : 'signedOut');
      setUserId(session?.user.id ?? null);
      setEmail(session?.user.email ?? null);
      // Sprint 7j item 4: consume any pending invite for this email the
      // moment a real sign-in establishes a session — not on every token
      // refresh. Covers both a fresh signup (`atlas.consume_invites_for_new_user`'s
      // own `auth.users` trigger already catches that case on its own)
      // and an existing account signing in for the first time after being
      // invited, which that trigger can't see (`db/invites.ts`'s own
      // module comment). Fire-and-forget: signing in must never be
      // blocked by an unrelated invite-consumption hiccup, and a hiccup
      // just leaves the invite pending for the next sign-in to retry.
      if (event === 'SIGNED_IN') {
        void consumeMyInvites(supabase).catch(() => undefined);
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signInWithPassword = useCallback(async (emailInput: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: emailInput, password });
    return { error: error?.message ?? null };
  }, []);

  const signUpWithPassword = useCallback(async (emailInput: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email: emailInput, password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, userId, email, signInWithPassword, signUpWithPassword, signOut }),
    [status, userId, email, signInWithPassword, signUpWithPassword, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
