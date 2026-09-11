import { useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { BranchRow } from '../../db/types';
import { mergeApprovedRequest } from '../../db/mergeRequests';
import { previewSplitClosure, splitAndMergeSubset } from '../../db/split';
import type { MergeReview } from '../../engine/merge';
import type { SplitClosureResult } from '../../engine/splitClosure';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import styles from './SplitReviewPanel.module.css';

export interface SplitReviewPanelProps {
  modelId: UUID;
  branch: BranchRow;
  mainHeadCommitId: UUID;
  review: MergeReview;
  /** Same role gate as Approve/Merge (ADR-006 amendment step 2: "Role: owner/architect"). */
  canSplit: boolean;
  /** Called after a successful split+merge, so the caller re-fetches the review (the branch's own changeset has shrunk). */
  onSplit: () => void;
}

interface BranchSubject {
  id: UUID;
  kind: 'element' | 'relationship';
  label: string;
  action: 'created' | 'updated' | 'retracted';
}

/** Every subject the branch's own commits touch, for display — `review.threeWay.fields`'s own `OURS`/`CONVERGED` classification is exactly "changed by our branch" (SPEC §7.2), the same universe `computeSplitClosure`'s own `listOwnDeltas`-derived changeset independently re-derives when a split is actually requested; this is display only, not the source of truth for what a split can include. */
function branchSubjectsOf(review: MergeReview): BranchSubject[] {
  const { base, ours, fields } = review.threeWay;
  const ids = new Set(fields.filter((f) => f.classification === 'OURS' || f.classification === 'CONVERGED').map((f) => f.subjectId));
  const subjects: BranchSubject[] = [];
  for (const id of ids) {
    const el = ours.elements.get(id);
    const wasEl = base.elements.get(id);
    const rel = ours.relationships.get(id);
    const wasRel = base.relationships.get(id);
    if (el || wasEl) {
      const action = el && !wasEl ? 'created' : !el && wasEl ? 'retracted' : 'updated';
      subjects.push({ id, kind: 'element', label: (el ?? wasEl)?.name ?? id, action });
    } else if (rel || wasRel) {
      const action = rel && !wasRel ? 'created' : !rel && wasRel ? 'retracted' : 'updated';
      const type = (rel ?? wasRel)?.relationshipType ?? 'relationship';
      subjects.push({ id, kind: 'relationship', label: `${type} relationship`, action });
    }
  }
  return subjects;
}

function labelFor(subjects: BranchSubject[], id: UUID): string {
  return subjects.find((s) => s.id === id)?.label ?? id;
}

/**
 * Sprint C2 (Prompt 7b), ADR-006 amendment: "per-element accept/skip;
 * closure preview... before confirm; confirm -> split_branch ->
 * merge_branch on the split, whole, in one user action." One checkbox per
 * subject the branch's own commits touch — checking any of them
 * recomputes the closure preview (`src/db/split.ts`'s `previewSplitClosure`)
 * so pulled-in/blocked subjects are visible before the reviewer confirms,
 * never after.
 */
export function SplitReviewPanel({ modelId, branch, mainHeadCommitId, review, canSplit, onSplit }: SplitReviewPanelProps) {
  const subjects = useMemo(() => branchSubjectsOf(review), [review]);
  const [requested, setRequested] = useState<Set<UUID>>(new Set());
  const [closure, setClosure] = useState<SplitClosureResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'working'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!canSplit || subjects.length < 2) {
    // A split only makes sense once there's more than one subject to
    // choose *between* — nothing to accept "a subset" of otherwise (an
    // ordinary Approve/Merge already covers "accept everything").
    return null;
  }

  async function refreshPreview(next: Set<UUID>) {
    setPreviewing(true);
    try {
      const result = await previewSplitClosure(supabase, { modelId, branch, mainHeadCommitId, requestedSubjectIds: next });
      setClosure(result);
    } finally {
      setPreviewing(false);
    }
  }

  function toggle(id: UUID) {
    const next = new Set(requested);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setRequested(next);
    void refreshPreview(next);
  }

  async function confirmSplit() {
    if (!closure || closure.accepted.size === 0) return;
    setStatus('working');
    setError(null);
    try {
      const splitTitle = `Split from ${branch.title ?? branch.name}`;
      const result = await splitAndMergeSubset(supabase, {
        modelId,
        branch,
        mainHeadCommitId,
        requestedSubjectIds: requested,
        splitBranchName: `${branch.name}-split-${crypto.randomUUID().slice(0, 8)}`,
        splitBranchTitle: splitTitle,
      });
      if (!result.ok) {
        setError(result.reason === 'error' ? result.message : 'Nothing was accepted — every selected item was blocked.');
        return;
      }
      const mergeResult = await mergeApprovedRequest(supabase, modelId, result.mergeRequestId, result.splitBranch, splitTitle);
      if (!mergeResult.ok) {
        setError(mergeResult.message);
        return;
      }
      setRequested(new Set());
      setClosure(null);
      onSplit();
    } finally {
      setStatus('idle');
    }
  }

  return (
    <Panel>
      <Text as="h2" size="lg">
        Split — deliver part of this change now
      </Text>
      <Text as="p" tone="muted" size="sm">
        Accept a subset of this branch's own changes into a new, immediately-merged branch. The rest stays here, untouched, for a later review.
      </Text>
      <ul className={styles.list}>
        {subjects.map((s) => (
          <li key={s.id} className={styles.row}>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={requested.has(s.id)} onChange={() => { toggle(s.id); }} disabled={status === 'working'} />
              <Text as="span" size="sm">
                {s.action} — {s.label}
              </Text>
            </label>
            {closure?.pulledIn.has(s.id) && (
              <Text as="span" size="xs" tone="muted">
                (pulled in)
              </Text>
            )}
          </li>
        ))}
      </ul>

      {closure && closure.blocked.length > 0 && (
        <div className={styles.blockedList}>
          <Text as="p" size="sm">
            Blocked:
          </Text>
          <ul>
            {closure.blocked.map((b) => (
              <li key={b.subjectId}>
                <Text as="span" size="sm" tone="muted">
                  {labelFor(subjects, b.subjectId)} — still needed by {labelFor(subjects, b.dependentSubjectId)}
                  {b.dependentIsPreExisting ? ' (already on main)' : ''}. Select it too, or leave both for later.
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error !== null && <Text as="p">{error}</Text>}

      <Button
        variant="primary"
        disabled={!closure || closure.accepted.size === 0 || previewing || status === 'working'}
        onClick={() => {
          void confirmSplit();
        }}
      >
        {status === 'working' ? 'Splitting…' : closure && closure.accepted.size > 0 ? `Split ${String(closure.accepted.size)} item${closure.accepted.size === 1 ? '' : 's'} & merge now` : 'Select items to split off'}
      </Button>
    </Panel>
  );
}
