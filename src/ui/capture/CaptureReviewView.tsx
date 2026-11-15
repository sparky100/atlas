/**
 * F2 (full K1) PR15, SPEC-capture.md §10: the review queue for one capture
 * job — grouped by class in §10's own order (needs-decision-first,
 * bulk-accepted confirmations last), a target-change picker, "Apply
 * decisions," and the keyboard shortcuts §10's own per-class table names
 * (plus `j`/`k` to move the selection, an addition beyond that table since
 * every key in it is scoped to "the" unit being reviewed and nothing in
 * this codebase had an existing list-navigation convention to match — see
 * `CaptureCandidateRow.tsx`'s own module comment for the layout
 * consequence of that same gap).
 *
 * All interactive state a shortcut needs to reach — the selected
 * candidate, which panel (if any) is open, the `confirm`/`new` classes'
 * own multi-select, and an `ambiguous` pick pending its own `a`
 * confirmation — lives here, not in `useCaptureReviewQueue.ts` (that hook
 * owns server state and mutations only) nor in the row component (which
 * owns nothing a keypress needs to reach from outside).
 *
 * **Amended, Sprint F2b (SPEC-capture.md §10):** `x` multi-select is
 * widened from `confirm` alone to `confirm`/`new`, and `a`/`r` on a
 * non-empty selection now bulk-accept/reject it (previously `r` was the
 * only bulk action, `confirm`-only) — without this, a clean import that
 * resolves to all-`confirm`/all-`new` went from one commit (F2-lite) to
 * one keystroke per row. Bulk action reads `multiSelected` directly
 * rather than gating on the currently-focused candidate's own class, so
 * it fires regardless of which row `j`/`k` last landed on.
 */
import { Loading } from '../components/Loading/Loading';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { CandidateClass, CaptureCandidate } from '../../contracts/capture';
import { findBlockedCandidates } from '../../capture/findBlockedCandidates';
import { finishableWithoutApply } from '../../capture/finishableWithoutApply';
import { applyResultMessage } from './applyResultMessage';
import { Button } from '../components/Button/Button';
import { LinkButton } from '../components/Button/LinkButton';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { canDiscardCaptureJob, canRunCapture, useMembership } from '../orgs/useMembership';
import { reportToast } from '../toasts/toastStore';
import { captureJobStatusLabel } from './captureJobStatus';
import { CaptureCandidateRow, type PendingAmbiguousTarget } from './CaptureCandidateRow';
import { DiscardCaptureButton } from './DiscardCaptureButton';
import { useCaptureReviewQueue } from './useCaptureReviewQueue';
import styles from './CaptureReviewView.module.css';

export interface CaptureReviewViewProps {
  modelId: UUID;
  orgId: UUID;
  jobId: UUID;
  /** Where Finish review / Discard land the reviewer once the job leaves `parsed` — the model's review queue. */
  reviewQueueHref: string;
}

/** Classes `x` multi-select (and so the bulk bar and a group's "Select all") covers — SPEC-capture.md §10, Sprint F2b. */
const MULTI_SELECT_CLASSES: ReadonlySet<CandidateClass> = new Set(['confirm', 'new']);

/** SPEC §10's own queue order: needs-decision-first, bulk-accepted confirmations last. `duplicate_in_target` (issue #285) sits beside `invalid`/`unsourced` — no delta, needs the reviewer's attention before anything else. */
const CLASS_ORDER: readonly CandidateClass[] = ['unsourced', 'invalid', 'duplicate_in_target', 'ambiguous', 'conflict', 'new', 'update', 'gone', 'confirm'];

const CLASS_LABEL: Record<CandidateClass, string> = {
  unsourced: 'Unsourced',
  invalid: 'Invalid',
  duplicate_in_target: 'Already proposed in this change',
  ambiguous: 'Check these match',
  conflict: 'Needs your decision',
  new: 'New',
  update: 'Changes',
  gone: 'Not in the file',
  confirm: 'Already up to date',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
}

export function CaptureReviewView({ modelId, orgId, jobId, reviewQueueHref }: CaptureReviewViewProps) {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const { role } = useMembership(orgId, userId);
  const canReview = canRunCapture(role);
  const queue = useCaptureReviewQueue(modelId, orgId, jobId, userId, role);
  const { status, error, job, candidates, changeBranches, mainElementById, mainRelationshipById, draftElementById, targetBranchId, setTargetBranchId, retry, decide, decideMany, apply, finish, discard, searchTargetElements, notInFile } = queue;

  const busy = status === 'applying' || status === 'closing';
  const isChangeBrief = job?.inputKind === 'change_brief';
  const [retrying, setRetrying] = useState(false);
  const [appliedBranchId, setAppliedBranchId] = useState<UUID | null>(null);
  const [selectedId, setSelectedId] = useState<UUID | null>(null);
  const [openPanel, setOpenPanel] = useState<{ candidateId: UUID; type: 'edit' | 'split' | 'merge' } | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<UUID>>(new Set());
  const [pendingAmbiguousTargets, setPendingAmbiguousTargets] = useState<Map<UUID, PendingAmbiguousTarget>>(new Map());
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  /** Class groups the reviewer has collapsed — toggled by the group header; a collapsed group hides its candidates but keeps its count. */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<CandidateClass>>(new Set<CandidateClass>(['confirm']));
  /**
   * The one thing the header's own "N candidate(s) · M decided" summary
   * couldn't answer: *which* ones. Found the hard way — a 147-candidate
   * queue with 132 decided has no way to see the other 15 without
   * scrolling every class group by eye, and an accepted relationship whose
   * own endpoint was left undecided among them silently breaks Apply
   * (`explainPromotionError.ts`'s own doc comment tells that exact story).
   * Filters the same `candidates` list every class group already reads
   * from, so it composes with class grouping rather than replacing it —
   * "Needs review" under "New" is still "New," just narrowed.
   */
  const [decisionFilter, setDecisionFilter] = useState<'all' | 'needsReview' | 'decided' | 'blocked'>('all');
  const needsReviewCount = useMemo(() => candidates.filter((c) => c.decision === null).length, [candidates]);
  const decidedCount = candidates.length - needsReviewCount;
  /**
   * The other half of that same story, surfaced *before* Apply ever runs:
   * every candidate `findBlockedCandidates.ts` can already tell, from the
   * candidate list alone, will fail to promote — an accepted relationship
   * (or a container/capability's own parent) referencing a sibling
   * candidate that's rejected or still undecided. `explainPromotionError.ts`
   * still explains it if you apply anyway; this filter means finding it
   * doesn't require applying and reading the error first.
   */
  const blockedCandidateIds = useMemo(() => findBlockedCandidates(candidates), [candidates]);
  const filteredCandidates = useMemo(() => {
    if (decisionFilter === 'all') return candidates;
    if (decisionFilter === 'blocked') return candidates.filter((c) => blockedCandidateIds.has(c.id));
    return candidates.filter((c) => (decisionFilter === 'needsReview' ? c.decision === null : c.decision !== null));
  }, [candidates, decisionFilter, blockedCandidateIds]);

  // The Blocked filter exists to show those items, so it opens every group — a blocked item sitting in a group collapsed by default (`confirm`) would otherwise leave the filter looking empty.
  const isGroupCollapsed = (cls: CandidateClass): boolean => decisionFilter !== 'blocked' && collapsedGroups.has(cls);
  const grouped = useMemo(() => CLASS_ORDER.map((cls) => ({ cls, items: filteredCandidates.filter((c) => c.class === cls) })).filter((g) => g.items.length > 0), [filteredCandidates]);
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Defaults to the first candidate rather than resetting `selectedId`
  // itself via an effect — `selectedId` stays `null` until the reviewer
  // (or a keyboard command) picks something explicitly; this is only what
  // gets *shown* as selected in the meantime.
  const effectiveSelectedId = selectedId ?? flat[0]?.id ?? null;
  const selectedCandidate = flat.find((c) => c.id === effectiveSelectedId) ?? null;

  /** §8.2 (amended): nothing left to promote — the primary action becomes "Finish review", which needs no target change. */
  const finishable = useMemo(() => finishableWithoutApply(candidates), [candidates]);

  const runFinish = useCallback(() => {
    void finish().then((done) => {
      if (!done) return;
      reportToast(isChangeBrief ? 'Draft review finished — nothing was applied.' : 'Import review finished — nothing was applied.');
      void navigate(reviewQueueHref);
    });
  }, [finish, isChangeBrief, navigate, reviewQueueHref]);

  const runDiscard = useCallback(
    () =>
      discard().then((done) => {
        if (!done) return;
        reportToast(isChangeBrief ? 'AI draft discarded.' : 'Import draft discarded.');
        void navigate(reviewQueueHref);
      }),
    [discard, isChangeBrief, navigate, reviewQueueHref],
  );

  const runApply = useCallback(() => {
    void apply().then((result) => {
      if (!result) return;
      setApplyMessage(applyResultMessage(result));
      if (isChangeBrief) setAppliedBranchId(result.targetBranchId);
    });
  }, [apply, isChangeBrief]);

  const bulkDecide = useCallback(
    (decision: 'accepted' | 'rejected') => {
      decideMany([...multiSelected].map((id) => ({ candidateId: id, decision })));
      setMultiSelected(new Set());
    },
    [decideMany, multiSelected],
  );

  const setDecisionFor = useCallback(
    (candidate: CaptureCandidate, decision: Parameters<typeof decide>[1], decisionDetail?: Parameters<typeof decide>[2]) => {
      decide(candidate.id, decision, decisionDetail ?? null);
    },
    [decide],
  );

  useEffect(() => {
    if (!canReview || busy) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (finishable) {
          runFinish();
          return;
        }
        runApply();
        return;
      }
      if (e.key === 'j' || e.key === 'k') {
        if (flat.length === 0) return;
        const index = flat.findIndex((c) => c.id === effectiveSelectedId);
        const nextIndex = e.key === 'j' ? Math.min(flat.length - 1, index + 1) : Math.max(0, index - 1);
        setSelectedId(flat[nextIndex]?.id ?? null);
        return;
      }
      if (e.key === 't') {
        document.getElementById('capture-review-target-branch')?.focus();
        return;
      }
      if (!selectedCandidate) return;
      const candidate = selectedCandidate;
      switch (e.key) {
        case 'a': {
          if (multiSelected.size > 0) {
            bulkDecide('accepted');
          } else if (candidate.class === 'ambiguous') {
            const pending = pendingAmbiguousTargets.get(candidate.id) ?? null;
            if (pending) setDecisionFor(candidate, 'accepted', pending === 'new' ? null : { intoElementId: pending.elementId });
          } else if (candidate.class !== 'invalid' && candidate.class !== 'unsourced' && candidate.class !== 'duplicate_in_target') {
            setDecisionFor(candidate, 'accepted');
          }
          break;
        }
        case 'r': {
          if (multiSelected.size > 0) {
            bulkDecide('rejected');
          } else {
            setDecisionFor(candidate, 'rejected');
          }
          break;
        }
        case 'u':
          setDecisionFor(candidate, null, null);
          setPendingAmbiguousTargets((prev) => {
            const next = new Map(prev);
            next.delete(candidate.id);
            return next;
          });
          break;
        case 'e':
          // §10's per-class key table lists `e` for every class except `confirm` (a, r, x only) — editing a
          // pure provenance-refresh candidate would let a reviewer silently turn it into a hand-edited fact.
          // `duplicate_in_target` (issue #285) has no delta at all to edit into being — only `r` applies.
          if (candidate.class !== 'confirm' && candidate.class !== 'duplicate_in_target') setOpenPanel({ candidateId: candidate.id, type: 'edit' });
          break;
        case 's':
          if (candidate.class === 'new' || candidate.class === 'update') setOpenPanel({ candidateId: candidate.id, type: 'split' });
          break;
        case 'm':
          if ((candidate.class === 'new' || candidate.class === 'ambiguous') && targetBranchId) setOpenPanel({ candidateId: candidate.id, type: 'merge' });
          break;
        case 'n':
          if (candidate.class === 'ambiguous') setPendingAmbiguousTargets((prev) => new Map(prev).set(candidate.id, 'new'));
          break;
        case 'x':
          if (MULTI_SELECT_CLASSES.has(candidate.class)) {
            setMultiSelected((prev) => {
              const next = new Set(prev);
              if (next.has(candidate.id)) next.delete(candidate.id);
              else next.add(candidate.id);
              return next;
            });
          }
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5': {
          if (candidate.class === 'ambiguous') {
            const target = candidate.match.ambiguous?.[Number(e.key) - 1];
            if (target) setPendingAmbiguousTargets((prev) => new Map(prev).set(candidate.id, { elementId: target.elementId, name: target.name }));
          }
          break;
        }
        default:
          break;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [canReview, busy, selectedCandidate, effectiveSelectedId, flat, multiSelected, pendingAmbiguousTargets, targetBranchId, bulkDecide, setDecisionFor, runApply, finishable, runFinish]);

  const toggleSelectAll = useCallback((items: readonly CaptureCandidate[]) => {
    setMultiSelected((prev) => {
      const next = new Set(prev);
      const allSelected = items.every((c) => next.has(c.id));
      for (const c of items) {
        if (allSelected) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback((cls: CandidateClass) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls);
      else next.add(cls);
      return next;
    });
  }, []);

  if (status === 'loading') return <Loading />;
  if (status === 'error' || !job) return <Text as="p">{error ?? "Couldn't load this import review."}</Text>;

  const changeHref = (branchId: UUID) => `${reviewQueueHref.replace(/\/review$/, '')}/changes/${branchId}`;
  if (isChangeBrief && job.status === 'pending') {
    const failure = error ?? job.error?.message;
    return (
      <Panel>
        <Text as="h2" size="lg">{job.inputName}</Text>
        {failure ? <p role="alert">{failure}</p> : <p role="status">Generating proposed edits…</p>}
        {(failure !== undefined || retrying) && (
          <Button disabled={retrying} onClick={() => {
            setRetrying(true);
            void retry().finally(() => { setRetrying(false); });
          }}>{retrying ? 'Retrying…' : 'Retry'}</Button>
        )}
        <LinkButton to={reviewQueueHref} variant="secondary">Back to review queue</LinkButton>
      </Panel>
    );
  }

  // A reviewed or discarded job is closed: its decisions are history, not a queue to act on.
  if (job.status !== 'parsed') {
    return (
      <Panel>
        <Text as="p">
          {isChangeBrief && job.targetBranchId ? (applyMessage ?? 'Selected edits were applied to a draft Change.') : `This capture review is closed (${captureJobStatusLabel(job).toLowerCase()}).`}
        </Text>
        {isChangeBrief && job.targetBranchId && <LinkButton to={changeHref(job.targetBranchId)} variant="primary">Open draft Change</LinkButton>}
        <LinkButton to={reviewQueueHref} variant="secondary">
          Back to review queue
        </LinkButton>
      </Panel>
    );
  }

  const applyDisabledReason = finishable ? (busy ? 'Working…' : null) : busy ? 'Applying…' : null;
  const canDiscard = canDiscardCaptureJob(role, job, userId);

  return (
    <div>
      <div className={styles.header}>
        <Panel>
          <div className={styles.headerRow}>
            <Text as="p" size="sm" tone="muted">
              {isChangeBrief && `${job.inputName} · `}{candidates.length} items · {decidedCount} decided
            </Text>
          </div>
          <div className={styles.filterRow} role="group" aria-label="Filter by review status">
            <Button variant={decisionFilter === 'all' ? 'primary' : 'ghost'} onClick={() => { setDecisionFilter('all'); }}>
              All ({candidates.length})
            </Button>
            <Button variant={decisionFilter === 'needsReview' ? 'primary' : 'ghost'} onClick={() => { setDecisionFilter('needsReview'); }}>
              Needs review ({needsReviewCount})
            </Button>
            <Button variant={decisionFilter === 'decided' ? 'primary' : 'ghost'} onClick={() => { setDecisionFilter('decided'); }}>
              Decided ({decidedCount})
            </Button>
            <Button variant={decisionFilter === 'blocked' ? 'primary' : 'ghost'} onClick={() => { setDecisionFilter('blocked'); }} title="Decided candidates that reference another candidate you rejected or haven't decided yet — Apply will fail on these.">
              Blocked ({blockedCandidateIds.size})
            </Button>
          </div>
          <div className={styles.targetRow}>
            <Text as="label" size="sm" tone="muted">
              Add to
            </Text>
            <select
              id="capture-review-target-branch"
              className={styles.select}
              value={targetBranchId ?? ''}
              disabled={busy || (isChangeBrief && job.targetBranchId !== null)}
              onChange={(e) => {
                setTargetBranchId(e.target.value || null);
              }}
            >
              <option value="">{isChangeBrief ? 'A new Propose change' : 'A new change for this import'}</option>
              {changeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title ?? b.name}
                </option>
              ))}
            </select>
            {finishable ? (
              <Button variant="primary" disabled={!!applyDisabledReason} onClick={runFinish}>
                {status === 'closing' ? 'Finishing…' : 'Finish review'}
              </Button>
            ) : (
              <Button variant="primary" disabled={!!applyDisabledReason} title={applyDisabledReason ?? undefined} onClick={runApply}>
                {status === 'applying' ? 'Applying…' : isChangeBrief ? 'Apply to draft Change' : 'Apply decisions'}
              </Button>
            )}
          </div>
          {finishable && (
            <Text as="p" tone="muted" size="xs">
              Nothing left to apply — every remaining candidate is rejected. Finish review closes it without creating a change.
            </Text>
          )}
          {isChangeBrief && candidates.length === 0 && <Text as="p" size="sm">No applicable edits were found. Start a new draft with more specific system or relationship details.</Text>}
          {applyDisabledReason && (
            <Text as="p" tone="muted" size="xs">
              {applyDisabledReason}
            </Text>
          )}
          {applyMessage !== null && (
            <Text as="p" size="sm">
              {applyMessage}
            </Text>
          )}
          {isChangeBrief && appliedBranchId && <LinkButton to={changeHref(appliedBranchId)} variant="secondary">Open draft Change</LinkButton>}
          {error !== null && (
            <Text as="p" size="sm">
              {error}
            </Text>
          )}
          {canDiscard && <DiscardCaptureButton label="Discard this draft…" confirmText="Discard the whole import? Nothing from it reaches the model; decisions so far stay on record." onConfirm={runDiscard} />}
          {canReview && (
            <CollapsibleSection title="Keyboard shortcuts" defaultOpen={false}>
              <Text as="p" tone="faint" size="xs" className={styles.shortcuts}>
                j/k select · a accept · r reject · u undo · e edit · s split · m merge into… · 1-5/n pick a match · x select (up to date or new, then a/r for several) · t change · ⌘/Ctrl+Enter apply / finish
              </Text>
            </CollapsibleSection>
          )}
        </Panel>
      </div>

      {canReview && multiSelected.size > 0 && (
        <div className={styles.bulkBar} role="toolbar" aria-label="Bulk actions">
          <Text as="span" size="sm">
            {multiSelected.size} selected
          </Text>
          <Button variant="primary" onClick={() => { bulkDecide('accepted'); }}>
            Accept selected
          </Button>
          <Button variant="secondary" onClick={() => { bulkDecide('rejected'); }}>
            Reject selected
          </Button>
          <Button variant="ghost" onClick={() => { setMultiSelected(new Set()); }}>
            Clear
          </Button>
        </div>
      )}

      {!isChangeBrief && notInFile.length > 0 && (
        <div className={styles.header}>
          <Panel>
            <CollapsibleSection title="Not in file" meta={`(${String(notInFile.length)})`} defaultOpen={false}>
              <Text as="p" tone="muted" size="sm">
                Main's own systems and modules this document never mentioned — a question, not a removal.
              </Text>
              <ul className={styles.list}>
                {notInFile.map((element) => (
                  <li key={element.elementId} className={styles.notInFileRow}>
                    <ElementTypeGlyph type={element.elementType} label={element.name} />
                    <Text as="span" size="sm">
                      {element.name}
                    </Text>
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          </Panel>
        </div>
      )}

      {candidates.length === 0 ? (
        <Text tone="muted">No candidates in this draft.</Text>
      ) : filteredCandidates.length === 0 ? (
        <Text tone="muted">{decisionFilter === 'needsReview' ? 'Nothing left to review — every candidate has a decision.' : decisionFilter === 'blocked' ? "Nothing blocked — every decided candidate's own references are safe to apply." : 'Nothing decided yet.'}</Text>
      ) : (
        grouped.map(({ cls, items }) => (
          <div key={cls} className={styles.group}>
            <div className={styles.groupHeaderRow}>
              <button type="button" className={styles.groupHeader} aria-expanded={!isGroupCollapsed(cls)} onClick={() => { toggleGroup(cls); }}>
                <Text as="h2" size="lg">
                  {CLASS_LABEL[cls]} ({items.length})
                </Text>
                <Text as="span" tone="muted" size="sm">
                  {isGroupCollapsed(cls) ? 'Show ▸' : 'Hide ▾'}
                </Text>
              </button>
              {canReview && MULTI_SELECT_CLASSES.has(cls) && (
                <Button variant="ghost" onClick={() => { toggleSelectAll(items); }}>
                  {items.every((c) => multiSelected.has(c.id)) ? 'Deselect all' : 'Select all'}
                </Button>
              )}
            </div>
            {!isGroupCollapsed(cls) && (
              <ul className={styles.list} role="listbox">
                {items.map((candidate) => (
                  <CaptureCandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    mainElementById={mainElementById}
                    mainRelationshipById={mainRelationshipById}
                    draftElementById={draftElementById}
                    canReview={canReview && !busy}
                    selected={candidate.id === effectiveSelectedId}
                    onSelect={() => {
                      setSelectedId(candidate.id);
                    }}
                    multiSelected={multiSelected.has(candidate.id)}
                    onToggleMultiSelect={() => {
                      setMultiSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(candidate.id)) next.delete(candidate.id);
                        else next.add(candidate.id);
                        return next;
                      });
                    }}
                    editOpen={openPanel?.candidateId === candidate.id && openPanel.type === 'edit'}
                    onOpenEdit={() => {
                      setSelectedId(candidate.id);
                      setOpenPanel({ candidateId: candidate.id, type: 'edit' });
                    }}
                    onCloseEdit={() => {
                      setOpenPanel(null);
                    }}
                    splitOpen={openPanel?.candidateId === candidate.id && openPanel.type === 'split'}
                    onOpenSplit={() => {
                      setSelectedId(candidate.id);
                      setOpenPanel({ candidateId: candidate.id, type: 'split' });
                    }}
                    onCloseSplit={() => {
                      setOpenPanel(null);
                    }}
                    mergeOpen={openPanel?.candidateId === candidate.id && openPanel.type === 'merge'}
                    onOpenMerge={() => {
                      setSelectedId(candidate.id);
                      setOpenPanel({ candidateId: candidate.id, type: 'merge' });
                    }}
                    onCloseMerge={() => {
                      setOpenPanel(null);
                    }}
                    pendingAmbiguousTarget={pendingAmbiguousTargets.get(candidate.id) ?? null}
                    onSetPendingAmbiguousTarget={(target) => {
                      setPendingAmbiguousTargets((prev) => new Map(prev).set(candidate.id, target));
                    }}
                    onDecide={(decision, decisionDetail) => {
                      setDecisionFor(candidate, decision, decisionDetail);
                    }}
                    targetChosen={targetBranchId !== null}
                    searchTargetElements={searchTargetElements}
                  />
                ))}
              </ul>
            )}
          </div>
        ))
      )}
    </div>
  );
}
