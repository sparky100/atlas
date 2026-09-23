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
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { CandidateClass, CaptureCandidate } from '../../contracts/capture';
import { Button } from '../components/Button/Button';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { canRunCapture, useMembership } from '../orgs/useMembership';
import { CaptureCandidateRow, type PendingAmbiguousTarget } from './CaptureCandidateRow';
import { useCaptureReviewQueue } from './useCaptureReviewQueue';
import styles from './CaptureReviewView.module.css';

export interface CaptureReviewViewProps {
  modelId: UUID;
  orgId: UUID;
  jobId: UUID;
}

/** SPEC §10's own queue order: needs-decision-first, bulk-accepted confirmations last. `duplicate_in_target` (issue #285) sits beside `invalid`/`unsourced` — no delta, needs the reviewer's attention before anything else. */
const CLASS_ORDER: readonly CandidateClass[] = ['unsourced', 'invalid', 'duplicate_in_target', 'ambiguous', 'conflict', 'new', 'update', 'gone', 'confirm'];

const CLASS_LABEL: Record<CandidateClass, string> = {
  unsourced: 'Unsourced',
  invalid: 'Invalid',
  duplicate_in_target: 'Already proposed in this change',
  ambiguous: 'Ambiguous',
  conflict: 'Conflicts',
  new: 'New',
  update: 'Updates',
  gone: 'Gone',
  confirm: 'Confirmations',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
}

export function CaptureReviewView({ modelId, orgId, jobId }: CaptureReviewViewProps) {
  const { userId } = useAuth();
  const { role } = useMembership(orgId, userId);
  const canReview = canRunCapture(role);
  const queue = useCaptureReviewQueue(modelId, orgId, jobId, userId);
  const { status, error, job, candidates, changeBranches, mainElementById, mainRelationshipById, draftElementById, targetBranchId, setTargetBranchId, createTargetBranch, decide, decideMany, apply, searchTargetElements, notInFile } = queue;

  const [selectedId, setSelectedId] = useState<UUID | null>(null);
  const [openPanel, setOpenPanel] = useState<{ candidateId: UUID; type: 'edit' | 'split' | 'merge' } | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<UUID>>(new Set());
  const [pendingAmbiguousTargets, setPendingAmbiguousTargets] = useState<Map<UUID, PendingAmbiguousTarget>>(new Map());
  const [newBranchName, setNewBranchName] = useState('');
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  /** Class groups the reviewer has collapsed — toggled by the group header; a collapsed group hides its candidates but keeps its count. */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<CandidateClass>>(new Set());

  const grouped = useMemo(() => CLASS_ORDER.map((cls) => ({ cls, items: candidates.filter((c) => c.class === cls) })).filter((g) => g.items.length > 0), [candidates]);
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Defaults to the first candidate rather than resetting `selectedId`
  // itself via an effect — `selectedId` stays `null` until the reviewer
  // (or a keyboard command) picks something explicitly; this is only what
  // gets *shown* as selected in the meantime.
  const effectiveSelectedId = selectedId ?? flat[0]?.id ?? null;
  const selectedCandidate = flat.find((c) => c.id === effectiveSelectedId) ?? null;

  const setDecisionFor = useCallback(
    (candidate: CaptureCandidate, decision: Parameters<typeof decide>[1], decisionDetail?: Parameters<typeof decide>[2]) => {
      decide(candidate.id, decision, decisionDetail ?? null);
    },
    [decide],
  );

  useEffect(() => {
    if (!canReview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void apply().then((result) => {
          if (result) setApplyMessage(`Applied ${String(result.appliedCount)} candidate(s).`);
        });
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
            decideMany([...multiSelected].map((id) => ({ candidateId: id, decision: 'accepted' as const })));
            setMultiSelected(new Set());
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
            decideMany([...multiSelected].map((id) => ({ candidateId: id, decision: 'rejected' as const })));
            setMultiSelected(new Set());
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
          if (candidate.class === 'confirm' || candidate.class === 'new') {
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
  }, [canReview, selectedCandidate, effectiveSelectedId, flat, multiSelected, pendingAmbiguousTargets, targetBranchId, decideMany, setDecisionFor, apply]);

  const toggleGroup = useCallback((cls: CandidateClass) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls);
      else next.add(cls);
      return next;
    });
  }, []);

  if (status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (status === 'error' || !job) return <Text as="p">{error ?? "Couldn't load this capture review."}</Text>;

  const decidedCount = candidates.filter((c) => c.decision !== null).length;
  const applyDisabledReason = !targetBranchId ? 'Choose a target change first.' : status === 'applying' ? 'Applying…' : null;

  return (
    <div>
      <div className={styles.header}>
        <Panel>
          <div className={styles.headerRow}>
            <Text as="p" size="sm" tone="muted">
              {candidates.length} candidate(s) · {decidedCount} decided
            </Text>
          </div>
          <div className={styles.targetRow}>
            <Text as="label" size="sm" tone="muted">
              Target change
            </Text>
            <select
              id="capture-review-target-branch"
              className={styles.select}
              value={targetBranchId ?? ''}
              onChange={(e) => {
                setTargetBranchId(e.target.value || null);
              }}
            >
              <option value="">— choose —</option>
              {changeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title ?? b.name}
                </option>
              ))}
            </select>
            <input
              className={styles.input}
              placeholder="or name a new change…"
              value={newBranchName}
              onChange={(e) => {
                setNewBranchName(e.target.value);
              }}
            />
            <Button
              variant="ghost"
              disabled={newBranchName.trim().length === 0}
              onClick={() => {
                void createTargetBranch(newBranchName).then((id) => {
                  if (id) setNewBranchName('');
                });
              }}
            >
              Create
            </Button>
            <Button variant="primary" disabled={!!applyDisabledReason} title={applyDisabledReason ?? undefined} onClick={() => { void apply().then((result) => { if (result) setApplyMessage(`Applied ${String(result.appliedCount)} candidate(s).`); }); }}>
              {status === 'applying' ? 'Applying…' : 'Apply decisions'}
            </Button>
          </div>
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
          {error !== null && (
            <Text as="p" size="sm">
              {error}
            </Text>
          )}
          {canReview && (
            <Text as="p" tone="faint" size="xs" className={styles.shortcuts}>
              j/k select · a accept · r reject · u undo · e edit · s split · m merge into… · 1-5/n pick (ambiguous) · x select (confirm/new, then a/r bulk-acts) · t target · ⌘/Ctrl+Enter apply
            </Text>
          )}
        </Panel>
      </div>

      {notInFile.length > 0 && (
        <div className={styles.header}>
          <Panel>
            <CollapsibleSection title="Not in file" meta={`(${String(notInFile.length)})`} defaultOpen={false}>
              <Text as="p" tone="muted" size="sm">
                Main's own systems and modules this document never mentioned — a question, not a retraction.
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
      ) : (
        grouped.map(({ cls, items }) => (
          <div key={cls} className={styles.group}>
            <button type="button" className={styles.groupHeader} aria-expanded={!collapsedGroups.has(cls)} onClick={() => { toggleGroup(cls); }}>
              <Text as="h2" size="lg">
                {CLASS_LABEL[cls]} ({items.length})
              </Text>
              <Text as="span" tone="muted" size="sm">
                {collapsedGroups.has(cls) ? 'Show ▸' : 'Hide ▾'}
              </Text>
            </button>
            {!collapsedGroups.has(cls) && (
              <ul className={styles.list} role="listbox">
                {items.map((candidate) => (
                  <CaptureCandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    mainElementById={mainElementById}
                    mainRelationshipById={mainRelationshipById}
                    draftElementById={draftElementById}
                    canReview={canReview}
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
