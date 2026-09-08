import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import styles from './SignIn.module.css';

interface LocationState {
  from?: { pathname: string };
}

/**
 * Real password auth (SPEC §9's two roles start with a real session, no
 * shortcut). One form, a mode toggle between sign in and sign up — Atlas
 * has no separate invite-acceptance flow yet (not named in this sprint),
 * so signing up is how a first user creates an account before creating
 * their own organisation.
 */
export function SignIn() {
  const { status, signInWithPassword, signUpWithPassword } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedUpNeedsConfirmation, setSignedUpNeedsConfirmation] = useState(false);

  if (status === 'signedIn') {
    const from = (location.state as LocationState | null)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = mode === 'signIn' ? await signInWithPassword(email, password) : await signUpWithPassword(email, password);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (mode === 'signUp') setSignedUpNeedsConfirmation(true);
  }

  return (
    <div className={styles.page}>
      <Panel raised>
        <Text as="h1" size="xl">
          {mode === 'signIn' ? 'Sign in to Atlas' : 'Create an account'}
        </Text>
        {signedUpNeedsConfirmation ? (
          <Text tone="muted" as="p">
            Check your email to confirm the account, then sign in.
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
            {error !== null && (
              <Text tone="default" as="p" className={styles.error}>
                {error}
              </Text>
            )}
            <Button type="submit" variant="primary" disabled={submitting}>
              {mode === 'signIn' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        )}
        <div className={styles.modeSwitch}>
          <Button
            variant="ghost"
            onClick={() => {
              setMode(mode === 'signIn' ? 'signUp' : 'signIn');
              setError(null);
              setSignedUpNeedsConfirmation(false);
            }}
          >
            {mode === 'signIn' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
