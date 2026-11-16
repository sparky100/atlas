import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { countInvites } from '../../db/invites';
import { countGettingStarted } from '../../db/landscape';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import styles from './GetStarted.module.css';
import { gettingStartedDismissKey, gettingStartedSteps, showGettingStarted, type GettingStartedStep } from './gettingStarted';

function isDismissed(modelId: string): boolean {
  try {
    return window.localStorage.getItem(gettingStartedDismissKey(modelId)) === '1';
  } catch {
    return false;
  }
}

/**
 * "Get started" checklist for a model that is still being set up: import
 * capabilities, add an application, link it to a capability, assess it, invite a colleague (owners only). Ticks come from real
 * counts on main's head; each step links into the existing screen that does
 * it. Dismissal is per browser (localStorage) — it is a nudge, not data.
 */
export function GetStarted({ modelId, commitId, orgId, isOwner, orgSlug, modelSlug, onAddApplication }: { modelId: UUID; commitId: UUID | null; orgId: UUID; isOwner: boolean; orgSlug: string; modelSlug: string; onAddApplication: () => void }) {
  const [steps, setSteps] = useState<GettingStartedStep[] | null>(null);
  const [dismissed, setDismissed] = useState(() => isDismissed(modelId));

  useEffect(() => {
    if (!commitId || dismissed) return undefined;
    let cancelled = false;
    Promise.all([countGettingStarted(supabase, commitId), isOwner && orgId ? countInvites(supabase, orgId) : Promise.resolve(null)])
      .then(([counts, invites]) => {
        if (!cancelled) setSteps(gettingStartedSteps(counts, invites));
      })
      .catch((e: unknown) => {
        reportError("Couldn't load the get-started checklist.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [commitId, dismissed, isOwner, orgId]);

  if (dismissed || !steps || !showGettingStarted(steps)) return null;

  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const links: Record<GettingStartedStep['id'], { to: string; text: string }> = {
    capabilities: { to: `${base}/capability-map`, text: 'Open the capability map' },
    system: { to: `${base}/elements`, text: 'See what is already here' },
    link: { to: `${base}/capability-map`, text: 'Open the capability map' },
    assess: { to: `${base}/portfolio`, text: 'See your applications' },
    invite: { to: `/o/${orgSlug}/settings`, text: 'Open organisation settings' },
  };
  const hints: Record<GettingStartedStep['id'], string> = {
    capabilities: 'Start from a ready-made map for your sector, or add your own.',
    system: 'Use Add application below, or Import inventory if you already have a list.',
    link: 'Open an application and say which capability it supports.',
    assess: 'Open an application and choose its planned action: invest, tolerate, migrate or eliminate.',
    invite: 'Add their email and choose a role. They get an email with a link to join.',
  };

  return (
    <Panel>
      <Text as="h2" size="lg">
        Get started
      </Text>
      <ul aria-label="Get started steps" className={styles.list}>
        {steps.map((step) => (
          <li key={step.id} className={[styles.step, step.done ? styles.done : ''].filter(Boolean).join(' ')}>
            <span className={styles.mark} aria-hidden="true">
              {step.done ? '✓' : ''}
            </span>
            <div>
              <Text as="span" className={styles.label}>
                {step.label}
              </Text>
              {step.done && <span className={styles.srOnly}> (done)</span>}
              {!step.done && (
                <Text as="p" tone="muted" size="sm">
                  {hints[step.id]} <Link to={links[step.id].to}>{links[step.id].text} →</Link>
                  {step.id === 'capabilities' && (
                    <>
                      {' '}
                      Or <Link to={`${base}/capture`}>import a spreadsheet or document</Link>.
                    </>
                  )}
                </Text>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button variant="primary" onClick={onAddApplication}>
          Add application
        </Button>
        <Link to={`${base}/capture`} className={styles.actionLink}>
          Import inventory
        </Link>
      </div>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => {
          try {
            window.localStorage.setItem(gettingStartedDismissKey(modelId), '1');
          } catch {
            /* private mode: dismiss for this visit only */
          }
          setDismissed(true);
        }}
      >
        Dismiss
      </button>
    </Panel>
  );
}
