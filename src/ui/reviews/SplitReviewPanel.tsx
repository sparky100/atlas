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
import { subjectName } from './elementBreadcrumb';
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
      // "created — supports relationship" named nothing about *what* it
      // connects — the same "both ends named" fix `ConflictCards.tsx`'s
      // `CleanChanges` list already applies via this same helper (S1
      // item 3), reused here rather than a second, driftable definition
      // of a relationship's own display name.
      subjects.push({ id, kind: 'relationship', label: subjectName([base, ours], id), action });
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

  // S1 item 3: "split as the reviewer's own partial-accept mode, showing
  // the real closure preview (pulled in / blocked), not four flat
  // checkboxes." The closure was already computed (`refreshPreview` above,
  // unchanged) — what changes here is the render: three named groups
  // (Included, Blocked, Available) a reviewer reads as the actual closure
  // partition, instead of one flat checkbox list with small inline
  // annotations bolted on. Before anything is selected (`closure === null`)
  // there's only one group — every subject is simply "available."
  const blockedIds = new Set(closure?.blocked.map((b) => b.subjectId) ?? []);
  const includedSubjects = closure ? subjects.filter((s) => closure.accepted.has(s.id)) : [];
  const availableSubjects = subjects.filter((s) => !includedSubjects.some((i) => i.id === s.id) && !blockedIds.has(s.id));

  return (
    <Panel>
      <Text as="h2" size="lg">
        Deliver part of this change now
      </Text>
      <Text as="p" tone="muted" size="sm">
        Choose some of this change's edits to go live straight away, as a separate change. The rest stays here, untouched, for a later review.
      </Text>

      {includedSubjects.length > 0 && (
        <div className={styles.group}>
          <Text as="h3" size="sm" tone="muted">
            Included — will split off now ({includedSubjects.length})
          </Text>
          <ul className={styles.list}>
            {includedSubjects.map((s) => {
              const pulledIn = closure?.pulledIn.has(s.id) ?? false;
              return (
                <li key={s.id} className={styles.row}>
                  {pulledIn ? (
                    <Text as="span" size="sm">
                      {s.action} — {s.label}
                      <Text as="span" size="xs" tone="muted">
                        {' '}
                        (pulled in — needed by something else you selected)
                      </Text>
                    </Text>
                  ) : (
                    <label className={styles.checkboxRow}>
                      <input type="checkbox" checked={requested.has(s.id)} onChange={() => { toggle(s.id); }} disabled={status === 'working'} />
                      <Text as="span" size="sm">
                        {s.action} — {s.label}
                      </Text>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {closure && closure.blocked.length > 0 && (
        <div className={styles.group}>
          <Text as="h3" size="sm" tone="muted">
            Blocked — can't split off alone ({closure.blocked.length})
          </Text>
          <ul className={styles.blockedList}>
            {closure.blocked.map((b) => (
              <li key={b.subjectId}>
                <Text as="span" size="sm" tone="muted">
                  {labelFor(subjects, b.subjectId)} — still needed by {labelFor(subjects, b.dependentSubjectId)}
                  {b.dependentIsPreExisting ? ' (already in the live model)' : ''}. Select it too, or leave both for later.
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.group}>
        {(includedSubjects.length > 0 || (closure && closure.blocked.length > 0)) && (
          <Text as="h3" size="sm" tone="muted">
            Available ({availableSubjects.length})
          </Text>
        )}
        <ul className={styles.list}>
          {availableSubjects.map((s) => (
            <li key={s.id} className={styles.row}>
              <label className={styles.checkboxRow}>
                <input type="checkbox" checked={requested.has(s.id)} onChange={() => { toggle(s.id); }} disabled={status === 'working'} />
                <Text as="span" size="sm">
                  {s.action} — {s.label}
                </Text>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {error !== null && <Text as="p">{error}</Text>}

      <Button
        variant="primary"
        disabled={!closure || closure.accepted.size === 0 || previewing || status === 'working'}
        onClick={() => {
          void confirmSplit();
        }}
      >
        {status === 'working' ? 'Delivering…' : closure && closure.accepted.size > 0 ? `Deliver ${String(closure.accepted.size)} item${closure.accepted.size === 1 ? '' : 's'} now` : 'Select items to deliver'}
      </Button>
    </Panel>
  );
}
