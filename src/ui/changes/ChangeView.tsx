import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { ConfidenceDots } from '../components/ConfidenceDots/ConfidenceDots';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { LinkButton } from '../components/Button/LinkButton';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { branchStatusTone } from './branchStatus';
import { describeDelta } from './changeSummaryFormat';
import { useChange } from './useChange';
import { useChangeSummary } from './useChangeSummary';
import { useOpenMergeRequest } from './useOpenMergeRequest';
import { useSubmitForReview } from './useSubmitForReview';
import styles from './ChangeView.module.css';

export interface ChangeViewProps {
  modelId: UUID;
  branchId: UUID;
  orgSlug: string;
  modelSlug: string;
  /** Contributor+ (ADR-009) — the same gate `ChangesView`'s create form uses; a viewer sees the change read-only. */
  canEdit: boolean;
}

/**
 * A single change's own page (Sprint C1 step 3, UI-principles §2.4's
 * `/changes/{branchSlug}` route — routed on the branch's real id here,
 * since `branches` has no separate slug column of its own to route on,
 * unlike `organisations`/`models`).
 *
 * Sprint C1 step 6 fills in the sections step 3 left as honest
 * placeholders: this change's own deltas grouped by element/relationship,
 * the capabilities it affects via `supports`, other open changes touching
 * the same subjects, and the delivered/remaining lineage (ADR-006
 * amendment — real once the review queue's split mechanic exists to
 * produce one; empty and said so until then).
 *
 * Sprint C1 step 7 adds the one merge action that belongs on the change
 * page itself: submitting a draft for review (`draft -> proposed`,
 * SPEC §3.4). Everything else the review queue does (refresh, resolve,
 * approve, merge) lives on the review request's own page
 * (src/ui/reviews/ReviewRequestView.tsx) once a request exists — this page
 * only ever links to it.
 */
export function ChangeView({ modelId, branchId, orgSlug, modelSlug, canEdit }: ChangeViewProps) {
  const { status, branch, error, updateMetadata } = useChange(branchId);
  const summaryState = useChangeSummary(modelId, branch);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const navigate = useNavigate();
  const { request: openRequest } = useOpenMergeRequest(branchId);
  const submission = useSubmitForReview(modelId, branch);

  if (status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (status === 'not_found' || !branch) return <Text as="p">No change found for this id.</Text>;

  const startEditing = () => {
    setTitle(branch.title ?? '');
    setDescription(branch.description ?? '');
    setTargetDate(branch.target_date ?? '');
    setEditing(true);
  };

  return (
    <div>
      <div className={styles.meta}>
        <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
        {branch.target_date !== null && (
          <Text as="span" tone="muted" size="sm">
            Target: {branch.target_date}
          </Text>
        )}
        <Text as="span" tone="faint" size="xs">
          Updated {new Date(branch.updated_at).toLocaleString()}
        </Text>
      </div>

      {error !== null && <Text as="p">{error}</Text>}

      {(branch.status === 'draft' || openRequest !== null) && (
        <Panel>
          <Text as="h2" size="lg">
            Review
          </Text>
          {openRequest === undefined && (
            <Text tone="muted" size="sm">
              Checking for an open review request…
            </Text>
          )}
          {openRequest === null && branch.status === 'draft' && (
            <>
              <Text as="p" tone="muted" size="sm">
                Submitting opens the review queue for this change (SPEC §7.4) — a reviewer sees every delta, conflict, and affected capability before it can merge into main.
              </Text>
              {canEdit && (
                <Button
                  variant="primary"
                  disabled={submission.status === 'submitting'}
                  onClick={() => {
                    void submission.submit().then((mergeRequestId) => {
                      if (mergeRequestId) void navigate(`/o/${orgSlug}/m/${modelSlug}/review/${mergeRequestId}`);
                    });
                  }}
                >
                  {submission.status === 'submitting' ? 'Submitting…' : 'Submit for review'}
                </Button>
              )}
              {submission.error !== null && <Text as="p">{submission.error}</Text>}
            </>
          )}
          {openRequest && (
            <div className={styles.subjectTitle}>
              <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
              <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/review/${openRequest.id}`} variant="secondary">
                Open review →
              </LinkButton>
            </div>
          )}
        </Panel>
      )}

      {!editing ? (
        <Panel>
          <div className={styles.field}>
            <Text as="h2" size="lg">
              Description
            </Text>
            <Text as="p" tone={branch.description ? 'default' : 'muted'}>
              {branch.description ?? 'No description.'}
            </Text>
          </div>
          {canEdit && (
            <Button variant="secondary" onClick={startEditing}>
              Edit
            </Button>
          )}
        </Panel>
      ) : (
        <Panel>
          <form
            className={styles.editForm}
            onSubmit={(e) => {
              e.preventDefault();
              void updateMetadata({
                title: title.trim().length > 0 ? title.trim() : null,
                description: description.trim().length > 0 ? description.trim() : null,
                targetDate: targetDate.trim().length > 0 ? targetDate.trim() : null,
              }).then(() => {
                setEditing(false);
              });
            }}
          >
            <input
              className={styles.input}
              type="text"
              placeholder="Title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
            <textarea
              className={styles.textarea}
              placeholder="Description"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
            />
            <input
              className={styles.input}
              type="date"
              value={targetDate}
              onChange={(e) => {
                setTargetDate(e.target.value);
              }}
            />
            <div className={styles.actions}>
              <Button variant="primary" type="submit" disabled={status === 'saving'}>
                Save
              </Button>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Panel>
      )}

      <Panel>
        <Text as="h2" size="lg">
          Deltas on this change
        </Text>
        {summaryState.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {summaryState.status === 'error' && <Text as="p">{summaryState.message}</Text>}
        {summaryState.status === 'ready' && summaryState.summary.subjects.length === 0 && <EmptyState>No deltas yet — this change hasn't diverged from main.</EmptyState>}
        {summaryState.status === 'ready' && summaryState.summary.subjects.length > 0 && (
          <ul className={styles.subjectList}>
            {summaryState.summary.subjects.map((subject) => (
              <li key={subject.subjectId} className={styles.subjectRow}>
                <div className={styles.subjectTitle}>
                  {subject.subjectType === 'element' && <ElementTypeGlyph type={subject.elementType} />}
                  <Text as="span" size="lg">
                    {subject.name}
                  </Text>
                </div>
                <ul className={styles.deltaList}>
                  {subject.deltas.map((delta) => {
                    const source = summaryState.summary.sourcesById.get(delta.sourceId);
                    return (
                      <li key={delta.id} className={styles.deltaRow}>
                        <Text as="span" size="sm">
                          {describeDelta(delta)}
                        </Text>
                        <Text as="span" tone="muted" size="sm">
                          {source?.name ?? delta.sourceId}
                        </Text>
                        <ConfidenceDots confidence={delta.confidence} />
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Affected capabilities
        </Text>
        {summaryState.status === 'ready' && summaryState.summary.affectedCapabilities.length === 0 && <EmptyState>No capabilities are affected by this change yet.</EmptyState>}
        {summaryState.status === 'ready' && summaryState.summary.affectedCapabilities.length > 0 && (
          <ul className={styles.capabilityList}>
            {summaryState.summary.affectedCapabilities.map(({ capability, viaSystems }) => (
              <li key={capability.element_id}>
                <div className={styles.subjectTitle}>
                  <ElementTypeGlyph type="capability" />
                  <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${capability.element_id}`}>
                    <Text as="span">{capability.name}</Text>
                  </Link>
                </div>
                {viaSystems.length > 0 && (
                  <Text as="p" tone="muted" size="sm">
                    via {viaSystems.map((s) => s.name).join(', ')}
                  </Text>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Other open changes touching the same elements
        </Text>
        {summaryState.status === 'ready' && summaryState.summary.otherOpenChanges.length === 0 && <EmptyState>No other open change touches the same elements.</EmptyState>}
        {summaryState.status === 'ready' && summaryState.summary.otherOpenChanges.length > 0 && (
          <ul className={styles.branchList}>
            {summaryState.summary.otherOpenChanges.map((other) => (
              <li key={other.id} className={styles.branchRow}>
                <Text as="span">{other.title ?? other.name}</Text>
                <div className={styles.subjectTitle}>
                  <Chip tone={branchStatusTone(other.status)}>{other.status}</Chip>
                  <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/changes/${other.id}`} variant="secondary">
                    Open →
                  </LinkButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Delivered / remaining
        </Text>
        {summaryState.status === 'ready' && summaryState.lineage.splits.length === 0 && (
          <Text as="p" tone="muted">
            {branch.split_from ? 'This change was split from another one.' : 'Not split yet — everything is still on this branch.'}
          </Text>
        )}
        {summaryState.status === 'ready' && summaryState.lineage.splits.length > 0 && (
          <ul className={styles.branchList}>
            {summaryState.lineage.splits.map((split) => (
              <li key={split.id} className={styles.branchRow}>
                <Text as="span">{split.title ?? split.name}</Text>
                <div className={styles.subjectTitle}>
                  <Chip tone={branchStatusTone(split.status)}>{split.status === 'merged' ? 'delivered' : split.status}</Chip>
                  <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/changes/${split.id}`} variant="secondary">
                    Open →
                  </LinkButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
