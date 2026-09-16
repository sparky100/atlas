import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link } from 'react-router';
import { authErrorMessage } from '../auth/authErrorMessage';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import styles from './SignIn.module.css';

/**
 * Sprint F7 item 3: the second half of "forgot password" — the link
 * `sendPasswordResetEmail` (`SignIn.tsx`'s own `forgotPassword` mode)
 * emails lands the user here already signed in (Supabase's recovery flow
 * establishes a temporary session the moment the link's own token is
 * processed, via the same `onAuthStateChange` listener `AuthProvider.tsx`
 * already runs for every auth event — no special handling needed here).
 * `/reset-password` is deliberately inside `RequireAuth`'s route group
 * (`App.tsx`): a signed-out visitor with no valid recovery token gets
 * redirected to `/sign-in` by that guard, exactly like any other route —
 * no separate "is this a real recovery session" check to get wrong.
 *
 * Reuses `SignIn.module.css` — same page shell, same form-field shapes;
 * a second small CSS module for one form would be pure duplication.
 */
export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await updatePassword(password);
    setSubmitting(false);
    if (result.error) {
      setError(authErrorMessage(result.error));
      return;
    }
    setDone(true);
  }

  return (
    <div className={styles.page}>
      <Panel raised>
        <Text as="h1" size="xl">
          Set a new password
        </Text>
        {done ? (
          <>
            <Text tone="muted" as="p">
              Your password has been updated.
            </Text>
            <Link to="/">
              <Button variant="primary">Continue to Atlas</Button>
            </Link>
          </>
        ) : (
          <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
            <label className={styles.field}>
              <Text size="sm" tone="muted" as="span">
                New password
              </Text>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
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
              {submitting ? 'Saving…' : 'Save new password'}
            </Button>
          </form>
        )}
      </Panel>
    </div>
  );
}
