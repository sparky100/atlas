import { useId, useState } from 'react';
import { isValidHandle } from '../../contracts/comments';
import { updateMyProfile } from '../../db/profiles';
import type { ProfileRow } from '../../db/types';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import styles from './ProfileView.module.css';

export interface ProfileViewProps {
  profile: ProfileRow;
  userId: string;
  /** Re-fetches the caller's own profile (`useOwnProfile.ts`'s `refresh`) after a successful save — this view keeps no local "did it save" state of its own beyond the form fields. */
  onSaved: () => void;
}

/**
 * Sprint F7 item 2: the profile page's identity panel, own-email display,
 * and "Sign out everywhere" — the one place a signed-in user can see or
 * change their own `atlas.profiles` row (display name, handle, avatar),
 * previously reachable only through the one-shot `DisplayNamePrompt` gate
 * on first sign-in, which never offered a "later." Notification
 * preferences (Sprint F7 item 3) mount as a sibling panel on the same
 * page, not built here.
 */
export function ProfileView({ profile, userId, onSaved }: ProfileViewProps) {
  const { email, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [handle, setHandle] = useState(profile.handle);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);

  const displayNameId = useId();
  const handleId = useId();
  const avatarUrlId = useId();

  const handleValid = isValidHandle(handle);

  async function handleSubmit() {
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      const result = await updateMyProfile(supabase, {
        userId,
        displayName: displayName.trim().length > 0 ? displayName.trim() : null,
        handle,
        avatarUrl: avatarUrl.trim().length > 0 ? avatarUrl.trim() : null,
      });
      if (result.status === 'handle_taken') {
        setSaveError('That handle is already taken — pick another.');
        return;
      }
      setSaved(true);
      onSaved();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save your profile.';
      setSaveError(message);
      reportError('Could not save your profile.', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Panel>
        <Text as="h2" size="lg">
          Your profile
        </Text>
        <Text as="p" tone="muted" size="sm">
          Shown to fellow organisation members next to your comments and edits — never your email (no one else can see that).
        </Text>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <label htmlFor={displayNameId}>
            <Text as="span" size="sm">
              Display name
            </Text>
          </label>
          <input
            id={displayNameId}
            className={styles.input}
            type="text"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
            }}
          />

          <label htmlFor={handleId}>
            <Text as="span" size="sm">
              Handle
            </Text>
          </label>
          <input
            id={handleId}
            className={styles.input}
            type="text"
            required
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value.toLowerCase());
            }}
          />
          {!handleValid && (
            <Text as="p" tone="muted" size="sm">
              Lowercase letters, numbers, hyphens and underscores only.
            </Text>
          )}

          <label htmlFor={avatarUrlId}>
            <Text as="span" size="sm">
              Avatar URL
            </Text>
          </label>
          <input
            id={avatarUrlId}
            className={styles.input}
            type="url"
            placeholder="https://…"
            value={avatarUrl}
            onChange={(e) => {
              setAvatarUrl(e.target.value);
            }}
          />

          <Text as="p" tone="muted" size="sm">
            Email: {email ?? '—'}
          </Text>

          {saveError !== null && <Text as="p">{saveError}</Text>}
          {saved && (
            <Text as="p" tone="muted" size="sm">
              Saved.
            </Text>
          )}

          <Button type="submit" variant="primary" disabled={saving || !handleValid || handle.trim().length === 0}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Sessions
        </Text>
        <Text as="p" tone="muted" size="sm">
          Ends every signed-in session on every device, not just this one — for when you've lost a device or shared credentials with someone you no longer want signed in.
        </Text>
        <Button
          variant="ghost"
          disabled={signingOutEverywhere}
          onClick={() => {
            setSigningOutEverywhere(true);
            void signOut('global');
          }}
        >
          {signingOutEverywhere ? 'Signing out…' : 'Sign out everywhere'}
        </Button>
      </Panel>
    </>
  );
}
