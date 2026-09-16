/**
 * Sprint F7 item 3 ("magic link and password reset verified on mobile;
 * error copy reviewed"): maps a raw Supabase Auth error message to one
 * plain, Atlas-authored sentence — the same "one plain sentence; detail
 * to console" rule `errorBannerStore.ts` already enforces for the global
 * banner, applied here to the one place in this app that still showed a
 * third-party API's raw error text verbatim, inline in the sign-in form.
 * Not routed through `reportError`/the global banner itself: an inline
 * form error (wrong password, a taken email) is a foreground result of
 * the user's own submit, not a background fetch failure — the two error
 * surfaces in this app have always been kept separate (`SignIn.tsx`'s own
 * inline `{error}` render vs. `ErrorBannerHost`), and this doesn't change
 * that split, only what text lands in the existing one.
 *
 * The raw message is always logged to console first — every mapped branch
 * below inspects Supabase's actual English wording (its API returns no
 * stable machine-readable error code for these cases), which is exactly
 * the kind of detail this function exists to hide from the user while
 * keeping inspectable for debugging.
 */
export function authErrorMessage(rawMessage: string): string {
  console.error('Auth error:', rawMessage);
  const lower = rawMessage.toLowerCase();

  if (lower.includes('invalid login credentials')) return "That email or password doesn't match an account.";
  if (lower.includes('already registered')) return 'An account already exists for that email — sign in instead.';
  if (lower.includes('email not confirmed')) return 'Confirm your email first — check your inbox for the link, then sign in.';
  if (lower.includes('email rate limit') || lower.includes('rate limit') || lower.includes('too many requests')) return 'Too many attempts — wait a few minutes and try again.';
  if (lower.includes('new password should be different')) return 'Choose a different password than your current one.';
  if (lower.includes('should be at least')) return 'Choose a password with at least 6 characters.';
  if (lower.includes('unable to validate email') || lower.includes('invalid email')) return "That doesn't look like a valid email address.";
  if (lower.includes('user not found')) return "That email doesn't match an account.";
  if (lower.includes('token has expired') || lower.includes('invalid token') || lower.includes('expired')) return 'That link has expired — request a new one.';
  if (lower.includes('failed to fetch') || lower.includes('network')) return "Couldn't reach the server — check your connection and try again.";

  return 'Something went wrong — try again.';
}
