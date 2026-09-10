import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { updateMyProfile } from '../../../db/profiles';
import { supabase } from '../../supabaseClient';
import { Button } from '../Button/Button';
import { Panel } from '../Panel/Panel';
import { Text } from '../Text/Text';
import styles from './DisplayNamePrompt.module.css';

export interface DisplayNamePromptProps {
  userId: string;
  onDone: () => void;
}

/**
 * Prompt 7h bug fix: "first sign-in prompts for a display name." Rendered
 * by `RequireAuth` in place of the app the first time the signed-in
 * user's own `atlas.profiles` row exists (Sprint M1a's own
 * `atlas.ensure_profile` — fires on the first organisation membership,
 * so this never fires before that) with `display_name` still `null` —
 * otherwise the identity every comment/commit header shows
 * (`CommentThread.tsx`'s own `authorLabel`) is a bare handle auto-derived
 * from the email's local part, never something the person chose. Same
 * full-page-panel shape `SignIn.tsx` uses for signing in itself: there's
 * nothing useful to see yet without a name to show fellow members.
 */
export function DisplayNamePrompt({ userId, onDone }: DisplayNamePromptProps) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateMyProfile(supabase, { userId, displayName: trimmed });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save your name');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <Panel raised>
        <Text as="h1" size="xl">
          What should we call you?
        </Text>
        <Text tone="muted" as="p">
          Your name is shown next to your comments and edits — you can change it later.
        </Text>
        <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
          <label className={styles.field}>
            <Text size="sm" tone="muted" as="span">
              Display name
            </Text>
            <input
              className={styles.input}
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- this prompt replaces the whole page; the input is the only thing on it to interact with.
              autoFocus
            />
          </label>
          {error !== null && (
            <Text tone="default" as="p" className={styles.error}>
              {error}
            </Text>
          )}
          <Button type="submit" variant="primary" disabled={submitting || name.trim().length === 0}>
            Continue
          </Button>
        </form>
      </Panel>
    </div>
  );
}
