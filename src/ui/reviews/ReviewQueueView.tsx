import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { LinkButton } from '../components/Button/LinkButton';
import { Text } from '../components/Text/Text';
import type { UUID } from '../../contracts/delta';
import { useAuth } from '../auth/useAuth';
import { captureJobStatusLabel, captureJobStatusTone } from '../capture/captureJobStatus';
import { useCaptureJobs } from '../capture/useCaptureJob';
import { cachedClassification } from './cachedClassification';
import { mergeRequestStatusTone } from './mergeRequestStatus';
import { useReviewQueue, type ReviewQueueRow } from './useReviewQueue';
import styles from './ReviewQueueView.module.css';

export interface ReviewQueueViewProps {
  modelId: UUID;
  orgId: UUID;
  orgSlug: string;
  modelSlug: string;
}

/**
 * The review queue's list (Sprint C1 step 7, UI-principles §2.4's `/review`
 * route): every open merge request on this model, plus (F2 "full K1" PR15)
 * every capture job whose draft is `parsed` and still has undecided
 * candidates — a "Capture drafts" section, shown only when one exists
 * (honestly-labelled per this file's own original convention, rather than
 * padding out an empty second section). `useCaptureJobs` (PR14) already
 * gives every job on this model; this view just filters and links onward,
 * rather than adding a second, capture-specific queue hook.
 */
export function ReviewQueueView({ modelId, orgId, orgSlug, modelSlug }: ReviewQueueViewProps) {
  const state = useReviewQueue(modelId);
  const { userId } = useAuth();
  const { jobs: captureJobs } = useCaptureJobs(modelId, orgId, userId);
  const captureDrafts = captureJobs.filter((j) => j.status === 'parsed');

  if (state.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;

  return (
    <div>
      {state.rows.length === 0 ? (
        <div>
          <EmptyState>No open merge requests. A change reaches this queue once its author submits it for review.</EmptyState>
          <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/changes`} variant="secondary">
            Changes →
          </LinkButton>
        </div>
      ) : (
        <ul className={styles.list}>
          {state.rows.map((row) => (
            <QueueRow key={row.request.id} row={row} orgSlug={orgSlug} modelSlug={modelSlug} />
          ))}
        </ul>
      )}

      {captureDrafts.length > 0 && (
        <>
          <Text as="h2" size="lg">
            Capture drafts
          </Text>
          <ul className={styles.list}>
            {captureDrafts.map((job) => (
              <li key={job.id} className={styles.row}>
                <div>
                  <Text as="span" size="lg">
                    {job.inputName}
                  </Text>
                  <div className={styles.rowMeta}>
                    <Chip tone={captureJobStatusTone(job)}>{captureJobStatusLabel(job)}</Chip>
                  </div>
                </div>
                <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/review/capture/${job.id}`} variant="secondary">
                  Review →
                </LinkButton>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
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
