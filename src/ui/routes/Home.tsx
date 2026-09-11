import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { useOwnProfile } from '../auth/useOwnProfile';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Button } from '../components/Button/Button';
import { DisplayNamePrompt } from '../components/DisplayNamePrompt/DisplayNamePrompt';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useOrganisations } from '../orgs/useOrganisations';
import styles from './Home.module.css';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The signed-in landing page: every organisation the user belongs to, plus
 * creating a new one. Which organisation/model to open next is the user's
 * own click — no auto-redirect invented for the one-org case.
 *
 * Prompt 7h bug fix: "first sign-in prompts for a display name." A
 * brand-new user has no `atlas.profiles` row at all until their first
 * organisation membership (Sprint M1a's `atlas.ensure_profile`), and
 * creating that first organisation happens right here, without leaving
 * this page (the new org appears in the list above, no navigation) — so
 * this is where a real "first sign-in" identity moment happens, and where
 * `DisplayNamePrompt` replaces the page (same full-page-panel shape as
 * `SignIn.tsx`) the moment the profile it creates still has no name.
 * Everywhere else in the app reaches a page only once the user already
 * has a profile with a name, so gating there too would be redundant.
 */
export function Home() {
  const { userId } = useAuth();
  const { profile, loading: profileLoading, refresh: refreshProfile } = useOwnProfile(userId);
  const { organisations, loading, error, createOrganisation } = useOrganisations();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (!profileLoading && profile?.display_name === null && userId) {
    return <DisplayNamePrompt userId={userId} onDone={refreshProfile} />;
  }

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      await createOrganisation(name.trim(), slugify(name), userId);
      setName('');
      setCreating(false);
      // The org's own creation trigger (`atlas.on_organisation_created`)
      // adds this user as its owner, which — for a first organisation —
      // is also the first time `atlas.ensure_profile` fires: re-fetch so
      // the display-name gate above picks up the freshly created profile
      // instead of the still-`null` one this page loaded with.
      refreshProfile();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create organisation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
        <Text as="h1" size="2xl">
          Your organisations
        </Text>
        {loading && (
          <Text tone="muted" as="p">
            Loading…
          </Text>
        )}
        {error !== null && (
          <Text tone="default" as="p">
            {error}
          </Text>
        )}
        {!loading && organisations.length === 0 && (
          <Panel>
            <Text as="p" tone="muted">
              You're not a member of any organisation yet. Create one to get started — you'll be its owner.
            </Text>
          </Panel>
        )}
        {organisations.length > 0 && (
          <ul className={styles.list}>
            {organisations.map((org) => (
              <li key={org.id} className={styles.listItem}>
                <Link to={`/o/${org.slug}`}>
                  <Text size="lg">{org.name}</Text>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.createSection}>
          {creating ? (
            <form onSubmit={(e) => void handleCreate(e)} className={styles.createForm}>
              <input
                placeholder="Organisation name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                className={styles.input}
              />
              <Button type="submit" variant="primary" disabled={submitting || name.trim().length === 0}>
                Create
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                }}
              >
                Cancel
              </Button>
              {createError !== null && <Text tone="default">{createError}</Text>}
            </form>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(true);
              }}
            >
              New organisation
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
