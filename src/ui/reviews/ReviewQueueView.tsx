import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { LinkButton } from '../components/Button/LinkButton';
import { Text } from '../components/Text/Text';
import type { UUID } from '../../contracts/delta';
import { cachedClassification } from './cachedClassification';
import { mergeRequestStatusTone } from './mergeRequestStatus';
import { useReviewQueue, type ReviewQueueRow } from './useReviewQueue';
import styles from './ReviewQueueView.module.css';

export interface ReviewQueueViewProps {
  modelId: UUID;
  orgSlug: string;
  modelSlug: string;
}

/**
 * The review queue's list (Sprint C1 step 7, UI-principles §2.4's `/review`
 * route): every open merge request on this model. Capture drafts are
 * UI-principles §5's other queue item kind — not built here (the capture
 * pipeline itself doesn't exist yet, ADR-004/SPEC §8's own deferral), so
 * this list is merge requests only, honestly labelled rather than padded
 * out with an empty second section.
 */
export function ReviewQueueView({ modelId, orgSlug, modelSlug }: ReviewQueueViewProps) {
  const state = useReviewQueue(modelId);

  if (state.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;
  if (state.rows.length === 0) return <EmptyState>No open merge requests. A change reaches this queue once its author submits it for review.</EmptyState>;

  return (
    <ul className={styles.list}>
      {state.rows.map((row) => (
        <QueueRow key={row.request.id} row={row} orgSlug={orgSlug} modelSlug={modelSlug} />
      ))}
    </ul>
  );
}

function QueueRow({ row, orgSlug, modelSlug }: { row: ReviewQueueRow; orgSlug: string; modelSlug: string }) {
  const { request, branch } = row;
  const classification = cachedClassification(request);
  const blockingCount = classification?.findings.filter((f) => f.blocking).length ?? 0;
  const advisoryCount = classification ? classification.findings.length - blockingCount : 0;

  return (
    <li className={styles.row}>
      <div>
        <Text as="span" size="lg">
          {branch?.title ?? branch?.name ?? request.branch_id}
        </Text>
        <div className={styles.rowMeta}>
          <Chip tone={mergeRequestStatusTone(request.status)}>{request.status.replace('_', ' ')}</Chip>
          {blockingCount > 0 && (
            <Text as="span" tone="muted" size="sm">
              {blockingCount} blocking conflict{blockingCount === 1 ? '' : 's'}
            </Text>
          )}
          {advisoryCount > 0 && (
            <Text as="span" tone="faint" size="xs">
              {advisoryCount} identity warning{advisoryCount === 1 ? '' : 's'}
            </Text>
          )}
          {classification && blockingCount === 0 && advisoryCount === 0 && (
            <Text as="span" tone="faint" size="xs">
              Clean
            </Text>
          )}
        </div>
      </div>
      <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/review/${request.id}`} variant="secondary">
        Review →
      </LinkButton>
    </li>
  );
}
