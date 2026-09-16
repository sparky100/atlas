import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { authErrorMessage } from '../auth/authErrorMessage';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import styles from './SignIn.module.css';

interface LocationState {
  from?: { pathname: string };
}

type Mode = 'signIn' | 'signUp' | 'magicLink' | 'forgotPassword';

const HEADINGS: Record<Mode, string> = {
  signIn: 'Sign in to Atlas',
  signUp: 'Create an account',
  magicLink: 'Email me a sign-in link',
  forgotPassword: 'Reset your password',
};

/**
 * Real password auth (SPEC §9's two roles start with a real session, no
 * shortcut). Atlas has no separate invite-acceptance flow yet (not named
 * in this sprint), so signing up is how a first user creates an account
 * before creating their own organisation.
 *
 * Sprint F7 item 3 adds two more modes, both email-only, both ending in
 * the same "check your email" state `signUp` already had: `magicLink`
 * (`supabase.auth.signInWithOtp` — a one-click sign-in link, no password)
 * and `forgotPassword` (`supabase.auth.resetPasswordForEmail`, landing on
 * `/reset-password`). Every error shown here — across all four modes —
 * now goes through `authErrorMessage` rather than Supabase's own raw
 * message (that function's own module comment has the full reasoning).
 */
export function SignIn() {
  const { status, signInWithPassword, signUpWithPassword, sendMagicLink, sendPasswordResetEmail } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionSent, setActionSent] = useState(false);

  if (status === 'signedIn') {
    const from = (location.state as LocationState | null)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setActionSent(false);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result =
      mode === 'signIn'
        ? await signInWithPassword(email, password)
        : mode === 'signUp'
          ? await signUpWithPassword(email, password)
          : mode === 'magicLink'
            ? await sendMagicLink(email)
            : await sendPasswordResetEmail(email);
    setSubmitting(false);
    if (result.error) {
      setError(authErrorMessage(result.error));
      return;
    }
    if (mode !== 'signIn') setActionSent(true);
  }

  return (
    <div className={styles.page}>
      <Panel raised>
        <Text as="h1" size="xl">
          {HEADINGS[mode]}
        </Text>
        {actionSent ? (
          <Text tone="muted" as="p">
            {mode === 'signUp' && 'Check your email to confirm the account, then sign in.'}
            {mode === 'magicLink' && 'Check your email for a sign-in link.'}
            {mode === 'forgotPassword' && 'Check your email for a link to reset your password.'}
          </Text>
        ) : (
          <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
            <label className={styles.field}>
              <Text size="sm" tone="muted" as="span">
                Email
              </Text>
              <input
                className={styles.input}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
              />
            </label>
            {(mode === 'signIn' || mode === 'signUp') && (
              <label className={styles.field}>
                <Text size="sm" tone="muted" as="span">
                  Password
                </Text>
                <input
                  className={styles.input}
                  type="password"
                  autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                />
              </label>
            )}
            {error !== null && (
              <Text tone="default" as="p" className={styles.error}>
                {error}
              </Text>
            )}
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create account' : mode === 'magicLink' ? 'Send link' : 'Send reset link'}
            </Button>
          </form>
        )}
        <div className={styles.modeSwitch}>
          {mode === 'signIn' && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  switchMode('signUp');
                }}
              >
                Don't have an account? Create one
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  switchMode('magicLink');
                }}
              >
                Email me a sign-in link instead
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  switchMode('forgotPassword');
                }}
              >
                Forgot password?
              </Button>
            </>
          )}
          {mode !== 'signIn' && (
            <Button
              variant="ghost"
              onClick={() => {
                switchMode('signIn');
              }}
            >
              Back to sign in
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}
