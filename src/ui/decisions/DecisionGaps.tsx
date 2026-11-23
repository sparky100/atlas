import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import type { DecisionGap, DecisionGapOrigin } from '../../contracts/decisionGap';
import { deleteDecisionGap, listDecisionGaps } from '../../db/decisionGaps';
import type { MemberRole } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import styles from './DecisionGaps.module.css';

const ORIGIN_LABEL: Readonly<Record<DecisionGapOrigin, string>> = {
  research: 'Found while researching the web',
  catalogue: 'Catalogue lookup',
  manual: 'Recorded by hand',
};

export interface DecisionGapsProps {
  decisionId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  /** The decision is proposed and this person may contribute. The database is the real gate. */
  canRemove: boolean;
  nameOfUser?: ((id: UUID) => string) | undefined;
  optionNameFor?: ((gap: DecisionGap) => string | null) | undefined;
}

/**
 * Phase 2a: the notes people recorded when a search or catalogue lookup did
 * not find what the decision needed. They are shown on the decision page so a
 * gap is visible to the next reader, not left inside a dialog. A note is not
 * evidence and never changes the model.
 */
export function DecisionGaps({ decisionId, userId, role, canRemove, nameOfUser, optionNameFor }: DecisionGapsProps) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['decisionGaps', decisionId],
    queryFn: () => listDecisionGaps(supabase, decisionId),
  });
  if (data === undefined || data.length === 0) return null;

  function remove(gap: DecisionGap): void {
    void deleteDecisionGap(supabase, gap.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['decisionGaps', decisionId] }))
      .catch((e: unknown) => {
        reportError("Couldn't remove that gap.", e);
      });
  }

  return (
    <Panel data-testid="decision-gaps">
      <Text as="h2" size="lg">
        What we could not find
      </Text>
      <Text as="p" size="sm" tone="muted">
        Short notes people recorded while researching this decision. They are not evidence and do not change the model.
      </Text>
      <ul className={styles.list}>
        {[...data].reverse().map((gap) => {
          const option = optionNameFor ? optionNameFor(gap) : null;
          const mayRemove = canRemove && (gap.createdBy === userId || role === 'owner' || role === 'architect');
          return (
            <li key={gap.id} className={styles.row}>
              <Text as="p" size="sm">{gap.body}</Text>
              <div className={styles.meta}>
                <Text as="span" size="xs" tone="muted">
                  {option === null ? 'For the decision' : `For ${option}`} · {ORIGIN_LABEL[gap.origin]} · recorded by{' '}
                  {nameOfUser ? nameOfUser(gap.createdBy) : 'a member'} on {gap.createdAt.slice(0, 10)}
                </Text>
                {mayRemove && (
                  <Button variant="ghost" onClick={() => { remove(gap); }} aria-label={`Remove gap: ${gap.body}`}>
                    Remove
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
