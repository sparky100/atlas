import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { branchStatusTone } from './branchStatus';
import { useChange } from './useChange';
import styles from './ChangeView.module.css';

export interface ChangeViewProps {
  branchId: UUID;
  /** Contributor+ (ADR-009) — the same gate `ChangesView`'s create form uses; a viewer sees the change read-only. */
  canEdit: boolean;
}

/**
 * A single change's own page (Sprint C1 step 3, UI-principles §2.4's
 * `/changes/{branchSlug}` route — routed on the branch's real id here,
 * since `branches` has no separate slug column of its own to route on,
 * unlike `organisations`/`models`).
 *
 * Honest placeholder (CLAUDE.md rule 7) for what later Sprint C1 steps
 * add: a summary of this change's own deltas grouped by element, the
 * capabilities it affects via `supports`, other open changes touching the
 * same elements, the As-is/To-be/Diff selector, and the merge/review
 * actions (submit, refresh, approve, merge). None of those exist yet —
 * this page is metadata (name, title, description, target date, status)
 * only, the foundation those steps build on.
 */
export function ChangeView({ branchId, canEdit }: ChangeViewProps) {
  const { status, branch, error, updateMetadata } = useChange(branchId);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');

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
        <Text as="p" tone="muted">
          A summary of this change's own deltas, grouped by element, is not built yet — editing on a change branch is a later Sprint C1 step.
        </Text>
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Affected capabilities
        </Text>
        <Text as="p" tone="muted">
          Capabilities this change affects via `supports` are not shown yet — this needs the delta summary above first.
        </Text>
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Other open changes touching the same elements
        </Text>
        <Text as="p" tone="muted">
          Not built yet.
        </Text>
      </Panel>
    </div>
  );
}
