import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { countInvites } from '../../db/invites';
import { countGettingStarted } from '../../db/landscape';
import type { MemberRole } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import styles from './GetStarted.module.css';
import { firstVisitContent, firstVisitDismissKey, gettingStartedSteps, showGettingStarted } from './gettingStarted';

function isDismissed(modelId: string): boolean {
  try {
    return window.localStorage.getItem(firstVisitDismissKey(modelId)) === '1';
  } catch {
    return false;
  }
}

/**
 * "First visit" card for someone opening a model that already has data (the
 * "Get started" checklist covers a model still being set up, and takes
 * precedence). What it says depends on the role: owners and architects are
 * pointed at "Where to focus", contributors at changes, viewers just at
 * browsing. Dismissal is per browser — a nudge, not data.
 */
export function FirstVisit({ modelId, commitId, orgId, role, orgSlug, modelSlug }: { modelId: UUID; commitId: UUID | null; orgId: UUID; role: MemberRole | null; orgSlug: string; modelSlug: string }) {
  const [dismissed, setDismissed] = useState(() => isDismissed(modelId));
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!commitId || dismissed || !role) return undefined;
    let cancelled = false;
    const canSeeChecklist = role !== 'viewer';
    Promise.all([countGettingStarted(supabase, commitId), role === 'owner' && orgId ? countInvites(supabase, orgId) : Promise.resolve(null)])
      .then(([counts, invites]) => {
        if (cancelled) return;
        const checklistOpen = canSeeChecklist && showGettingStarted(gettingStartedSteps(counts, invites));
        setShow(counts.capabilities > 0 && !checklistOpen);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load the first-visit card.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [commitId, dismissed, role, orgId]);

  if (dismissed || !show) return null;

  const { intro, links } = firstVisitContent(role);
  const base = `/o/${orgSlug}/m/${modelSlug}`;
  return (
    <Panel>
      <Text as="h2" size="lg">
        Welcome
      </Text>
      <Text as="p" tone="muted">
        {intro}
      </Text>
      <ul aria-label="Places to start" className={styles.list}>
        {links.map((l) => (
          <li key={l.to}>
            <Link to={`${base}/${l.to}`}>{l.text} →</Link>
          </li>
        ))}
      </ul>
      <Text as="p" tone="muted" size="sm">
        Stuck? The Help button at the top answers questions about Atlas.
      </Text>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => {
          try {
            window.localStorage.setItem(firstVisitDismissKey(modelId), '1');
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
