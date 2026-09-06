import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { LinkButton } from '../components/Button/LinkButton';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import type { BranchRow } from '../../db/types';
import { branchStatusTone } from './branchStatus';
import { useChanges } from './useChanges';
import styles from './ChangesView.module.css';

export interface ChangesViewProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  orgSlug: string;
  modelSlug: string;
  /** Contributor+ (ADR-009, `branches_insert`'s RLS) — omitted entirely, not shown disabled, otherwise (the same convention `canEditOnMain`'s callers already use). */
  canCreate: boolean;
}

/**
 * Sprint C1 step 3: "Create change (branch) with name, description, target
 * date" plus a list of every change on this model. Mirrors
 * src/ui/versions/VersionsView.tsx's shape (a create form gated by role,
 * loading/empty states, a list of rows linking onward). Editing on the
 * branch, the As-is/To-be/Diff selector, the change page's own delta
 * summary, and the merge review queue are later Sprint C1 steps — this is
 * create + list + a status chip only.
 */
export function ChangesView({ modelId, orgId, userId, orgSlug, modelSlug, canCreate }: ChangesViewProps) {
  const { status, branches, error, mainHeadCommitId, createChange } = useChanges(modelId, orgId, userId);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');

  return (
    <div>
      {canCreate && (
        <Panel>
          <Text as="h2" size="lg">
            New change
          </Text>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void createChange({ name, title, description, targetDate }).then((branch) => {
                if (branch) {
                  setName('');
                  setTitle('');
                  setDescription('');
                  setTargetDate('');
                }
              });
            }}
          >
            <input
              className={styles.input}
              type="text"
              placeholder="Name (e.g. retire-legacy-crm)"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              disabled={!mainHeadCommitId}
            />
            <input
              className={styles.input}
              type="text"
              placeholder="Title (e.g. Retire the legacy CRM)"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              disabled={!mainHeadCommitId}
            />
            <textarea
              className={styles.textarea}
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              disabled={!mainHeadCommitId}
            />
            <div className={styles.formRow}>
              <Text as="label" size="sm" tone="muted">
                Target date
              </Text>
              <input
                className={styles.input}
                type="date"
                value={targetDate}
                onChange={(e) => {
                  setTargetDate(e.target.value);
                }}
                disabled={!mainHeadCommitId}
              />
              <Button variant="primary" type="submit" disabled={status === 'creating' || !mainHeadCommitId}>
                {status === 'creating' ? 'Creating…' : 'Create change'}
              </Button>
            </div>
          </form>
          {!mainHeadCommitId && (
            <Text as="p" tone="muted" size="sm">
              This model has no commits yet — there is nothing to base a change on.
            </Text>
          )}
          {error !== null && <Text as="p">{error}</Text>}
        </Panel>
      )}

      <Text as="h2" size="lg">
        Changes
      </Text>
      {status === 'loading' && <Text tone="muted">Loading…</Text>}
      {branches.length === 0 && status !== 'loading' && <EmptyState>No changes yet. {canCreate ? 'Create one above.' : 'Nobody has proposed one.'}</EmptyState>}
      {branches.length > 0 && (
        <ul className={styles.list}>
          {branches.map((branch) => (
            <ChangeRow key={branch.id} branch={branch} orgSlug={orgSlug} modelSlug={modelSlug} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChangeRow({ branch, orgSlug, modelSlug }: { branch: BranchRow; orgSlug: string; modelSlug: string }) {
  return (
    <li className={styles.row}>
      <div>
        <Text as="span" size="lg">
          {branch.title ?? branch.name}
        </Text>
        {branch.description !== null && (
          <Text as="p" tone="muted" size="sm">
            {branch.description}
          </Text>
        )}
        <div className={styles.rowMeta}>
          <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
          {branch.target_date !== null && (
            <Text as="span" tone="faint" size="xs">
              Target: {branch.target_date}
            </Text>
          )}
        </div>
      </div>
      <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`} variant="secondary">
        Open →
      </LinkButton>
    </li>
  );
}
