import { createContext } from 'react';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  email: string | null;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  /** Sprint F7 item 3: `supabase.auth.signInWithOtp` — emails a one-click sign-in link, no password involved. */
  sendMagicLink: (email: string) => Promise<{ error: string | null }>;
  /** Sprint F7 item 3: `supabase.auth.resetPasswordForEmail`, redirecting to this app's own `/reset-password` (Supabase's own built-in auth email — separate from the Resend-backed invite email, F7 item 1). */
  sendPasswordResetEmail: (email: string) => Promise<{ error: string | null }>;
  /** Sprint F7 item 3: `supabase.auth.updateUser({password})` — called from `/reset-password` once the recovery link has established a temporary session. */
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  /**
   * Sprint F7 item 2: two meaningfully distinct actions, not one. `'local'`
   * (the default, and what `UserMenu.tsx`'s ordinary "Sign out" now uses)
   * ends only this device's session; `'global'` ends every session
   * everywhere — the profile page's own explicit "Sign out everywhere"
   * action, and the only way to reach it. Supabase JS v2's own default
   * scope is `'global'`, so before this change the single "Sign out"
   * button already signed out everywhere with no way to do only one
   * device — this makes that choice explicit and adds the narrower one.
   */
  signOut: (scope?: 'local' | 'global') => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
