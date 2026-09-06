import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(session ? 'signedIn' : 'signedOut');
      setUserId(session?.user.id ?? null);
      setEmail(session?.user.email ?? null);
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
