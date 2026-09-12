import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ChangeListSummary } from '../../db/changeSummary';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { LinkButton } from '../components/Button/LinkButton';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useSelectedRef } from '../branches/useSelectedRef';
import { useThreadCounts } from '../comments/useThreadCounts';
import type { BranchRow } from '../../db/types';
import { branchStatusTone } from './branchStatus';
import { useChangeSummaries } from './useChangeSummaries';
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
  const navigate = useNavigate();
  const { setRef } = useSelectedRef();
  const { status, branches, error, mainHeadCommitId, createChange } = useChanges(modelId, orgId, userId);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  // Changes list unresolved count (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s
  // 6b: "the meta row: branch status chip, Target: YYYY-MM-DD, and the
  // unresolved count") — `anchor_type = 'change'` counts key on the same
  // `anchor_id` (a branch's own id) regardless of anchor type, so the
  // batched RPC works unchanged here.
  const threadCountsState = useThreadCounts(
    modelId,
    branches.map((b) => b.id),
  );
  const threadCounts = threadCountsState.status === 'ready' ? threadCountsState.counts : undefined;
  // Item 3: affected capabilities + describeEnvelope one-liner, batched for
  // every card at once — see useChangeSummaries.ts's own comment.
  const summariesState = useChangeSummaries(modelId, branches);
  const summaries = summariesState.status === 'ready' ? summariesState.summaries : undefined;

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
                  // "The create-change flow lands you inside" — a freshly
                  // created change is always `draft`, so unlike
                  // `ChangePage.tsx`'s own "Edit in this change" there is no
                  // `canWorkInThisChange`-style gate to repeat here; select
                  // it as the active ref and go straight to its own page,
                  // same as clicking "Edit in this change" would.
                  setRef({ kind: 'branch', branchId: branch.id });
                  void navigate(`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`);
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
      {/* Item 5: first-time explainer — the model has never had a change,
          not just "this page hasn't loaded any yet" (status !== 'loading'
          already distinguishes that from the ordinary empty-list case
          below). */}
      {branches.length === 0 && status !== 'loading' && (
        <Panel>
          <Text as="p" size="sm">
            A change is a branch: a proposed edit to the model that doesn&rsquo;t touch main until it&rsquo;s reviewed and merged.
          </Text>
          <Text as="p" size="sm">
            Contributors never edit main directly — every edit from a contributor goes through a change like this one.
          </Text>
          <Text as="p" size="sm">
            Merging a change updates the landscape, capability map and every view that reads main&rsquo;s current state.
          </Text>
          {/* Sprint 7i item 5: versions, in the same explainer — a version
              (Versions page) is an optional named snapshot of main for
              later comparison, never a step a change has to pass through
              on its way to being merged. */}
          <Text as="p" size="sm">
            Versions (tagging main for later comparison) are optional snapshots — a change never needs one to be reviewed or merged.
          </Text>
        </Panel>
      )}
      {branches.length === 0 && status !== 'loading' && <EmptyState>No changes yet. {canCreate ? 'Create one above.' : 'Nobody has proposed one.'}</EmptyState>}
      {branches.length > 0 && (
        <ul className={styles.list}>
          {branches.map((branch) => (
            <ChangeRow
              key={branch.id}
              branch={branch}
              orgSlug={orgSlug}
              modelSlug={modelSlug}
              unresolvedCount={threadCounts?.get(branch.id)?.open}
              summary={summaries?.get(branch.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChangeRow({
  branch,
  orgSlug,
  modelSlug,
  unresolvedCount,
  summary,
}: {
  branch: BranchRow;
  orgSlug: string;
  modelSlug: string;
  unresolvedCount: number | undefined;
  /** `undefined` while `useChangeSummaries` is still loading, or if it failed — the card renders without this row rather than a loading placeholder for a nice-to-have. */
  summary: ChangeListSummary | undefined;
}) {
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
        {/* Item 3's own one-liner — distinct from the free-text description
            above: what this change actually *does*, derived from its own
            deltas, not what its author typed. */}
        {summary && summary.description !== 'No changes yet' && (
          <Text as="p" tone="muted" size="sm">
            {summary.description}
          </Text>
        )}
        <div className={styles.rowMeta}>
          <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
          {branch.target_date !== null && (
            <Text as="span" tone="faint" size="xs">
              Target: {branch.target_date}
            </Text>
          )}
          {/* Only the "has unresolved" state is real data — see
              `docs/SPEC-data-model.md` §11's "hollow marker" row for why a
              muted "all resolved" state isn't distinguishable from "no
              comments at all" with today's RPC, and isn't faked here. */}
          {unresolvedCount !== undefined && unresolvedCount > 0 ? (
            <Text as="span" tone="faint" size="xs">
              💬 {unresolvedCount} unresolved
            </Text>
          ) : (
            <Text as="span" tone="muted" size="xs">
              no comments
            </Text>
          )}
        </div>
        {summary && summary.affectedCapabilities.length > 0 && (
          <ul className={styles.affectedCapabilities}>
            {summary.affectedCapabilities.map(({ capability }) => (
              <li key={capability.element_id}>
                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${capability.element_id}`} className={styles.affectedCapabilityLink}>
                  <ElementTypeGlyph type="capability" />
                  <Text as="span" size="sm">
                    {capability.name}
                  </Text>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`} variant="secondary">
        Open →
      </LinkButton>
    </li>
  );
}
