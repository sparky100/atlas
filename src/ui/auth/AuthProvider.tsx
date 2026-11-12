import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { EntraJoinResult } from '../../contracts/entraTenant';
import { joinMyEntraOrg } from '../../db/entraTenants';
import { consumeMyInvites } from '../../db/invites';
import { queryKeys } from '../query/keys';
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
  const [membershipsGeneration, setMembershipsGeneration] = useState(0);
  const [microsoftJoin, setMicrosoftJoin] = useState<EntraJoinResult | null>(null);
  const queryClient = useQueryClient();

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
        // Once it settles, memberships may have changed: re-fetch the org
        // list and the profile (a first membership creates the profile row).
        const signedInUserId = session?.user.id ?? null;
        // A Microsoft sign-in also joins the organisation that recorded the
        // person's company (as a Viewer). Same fire-and-forget rule: never
        // blocks sign-in; a failure leaves the person where they were.
        void consumeMyInvites(supabase)
          .catch(() => undefined)
          .then(() => joinMyEntraOrg(supabase).catch(() => 'not_microsoft' as const))
          .then((joinResult) => {
            setMicrosoftJoin(joinResult === 'not_microsoft' ? null : joinResult);
            setMembershipsGeneration((g) => g + 1);
            void queryClient.invalidateQueries({ queryKey: queryKeys.ownProfile(signedInUserId) });
          });
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [queryClient]);

  const signInWithPassword = useCallback(async (emailInput: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: emailInput, password });
    return { error: error?.message ?? null };
  }, []);

  const signInWithMicrosoft = useCallback(async () => {
    // `email` is not granted by default for work accounts; `openid profile email` is what Supabase's Azure provider needs.
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo: window.location.origin } });
    return { error: error?.message ?? null };
  }, []);

  const signUpWithPassword = useCallback(async (emailInput: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email: emailInput, password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async (scope: 'local' | 'global' = 'local') => {
    await supabase.auth.signOut({ scope });
  }, []);

  const sendMagicLink = useCallback(async (emailInput: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email: emailInput, options: { emailRedirectTo: window.location.origin } });
    return { error: error?.message ?? null };
  }, []);

  const sendPasswordResetEmail = useCallback(async (emailInput: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(emailInput, { redirectTo: `${window.location.origin}/reset-password` });
    return { error: error?.message ?? null };
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error?.message ?? null };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, userId, email, membershipsGeneration, microsoftJoin, signInWithMicrosoft, signInWithPassword, signUpWithPassword, signOut, sendMagicLink, sendPasswordResetEmail, updatePassword }),
    [status, userId, email, membershipsGeneration, microsoftJoin, signInWithMicrosoft, signInWithPassword, signUpWithPassword, signOut, sendMagicLink, sendPasswordResetEmail, updatePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
