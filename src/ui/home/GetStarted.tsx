import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { countGettingStarted } from '../../db/landscape';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
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
 * capabilities, add a system, link it to a capability. Ticks come from real
 * counts on main's head; each step links into the existing screen that does
 * it. Dismissal is per browser (localStorage) — it is a nudge, not data.
 */
export function GetStarted({ modelId, commitId, orgSlug, modelSlug }: { modelId: UUID; commitId: UUID | null; orgSlug: string; modelSlug: string }) {
  const [steps, setSteps] = useState<GettingStartedStep[] | null>(null);
  const [dismissed, setDismissed] = useState(() => isDismissed(modelId));

  useEffect(() => {
    if (!commitId || dismissed) return undefined;
    let cancelled = false;
    countGettingStarted(supabase, commitId)
      .then((counts) => {
        if (!cancelled) setSteps(gettingStartedSteps(counts));
      })
      .catch((e: unknown) => {
        reportError("Couldn't load the get-started checklist.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [commitId, dismissed]);

  if (dismissed || !steps || !showGettingStarted(steps)) return null;

  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const links: Record<GettingStartedStep['id'], { to: string; text: string }> = {
    capabilities: { to: `${base}/capture`, text: 'Import' },
    system: { to: `${base}/elements`, text: 'See elements' },
    link: { to: `${base}/capability-map`, text: 'Open the capability map' },
  };
  const hints: Record<GettingStartedStep['id'], string> = {
    capabilities: 'Import a spreadsheet or document, or type a name in the search box above.',
    system: 'Type its name in the search box above and choose to create it.',
    link: 'Open a system and say which capability it supports.',
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
                </Text>
              )}
            </div>
          </li>
        ))}
      </ul>
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
