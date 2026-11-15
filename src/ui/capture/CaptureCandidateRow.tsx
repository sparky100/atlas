/**
 * F2 (full K1) PR15, SPEC-capture.md §10's per-class table: one candidate's
 * own row — every unit's shared anatomy (glyph/name, attribute rows, match
 * line, warnings, source passage) plus whatever the candidate's own
 * `class` adds. All interactive state that a keyboard shortcut also needs
 * to reach (which panel is open, an `ambiguous` pick pending confirmation,
 * the `confirm`/`new` multi-select — Sprint F2b widened this from
 * `confirm` alone) is owned by `CaptureReviewView` and passed
 * down as plain props — this component has no internal effect reacting to
 * "a command arrived," only ordinary controlled-panel state (form fields
 * while a panel is open), so a click and the matching keypress always run
 * through the exact same callback.
 *
 * Layout note: SPEC §10 describes a list with a source-passage pane "on
 * the right." This codebase has no existing two-pane list+detail layout
 * anywhere (`ReviewRequestView.tsx`'s own cards are each fully
 * self-contained instead) — this row follows that existing convention
 * instead of inventing a new split-pane layout from zero: the passage is
 * shown inline, right where the rest of this unit's evidence already is,
 * inside a `CollapsibleSection` (collapsed by default — the source ref
 * alone is usually enough context; the passage itself is what a reviewer
 * opens when actually checking a fact against the source).
 */
import { useEffect, useState } from 'react';
import type { ElementType, UUID } from '../../contracts/delta';
import type { CandidateDecision, CandidateDecisionDetail, CaptureCandidate } from '../../contracts/capture';
import { formatSourceRef } from '../../contracts/sourceRef';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import { candidateRefLabel } from './candidateRefLabel';
import { newAliasValues, sameName } from './captureRowText';
import { evidenceWarningLabel } from './evidenceWarningLabel';
import styles from './CaptureCandidateRow.module.css';

export type PendingAmbiguousTarget = { elementId: UUID; name: string } | 'new' | null;

export interface CaptureCandidateRowProps {
  candidate: CaptureCandidate;
  mainElementById: ReadonlyMap<UUID, ElementsHeadRow>;
  mainRelationshipById: ReadonlyMap<UUID, RelationshipsHeadRow>;
  /** This run's own newly-minted element names keyed by `draftSubjectId` — resolves a reference to a `new` element to its name. */
  draftElementById: ReadonlyMap<UUID, string>;
  /** Contributor+ (`stage_capture_decisions`'s own RLS floor) — a viewer sees every row read-only, with no action controls at all, same convention as every other role-gated affordance in this codebase. */
  canReview: boolean;
  selected: boolean;
  onSelect: () => void;
  multiSelected: boolean;
  onToggleMultiSelect: () => void;
  editOpen: boolean;
  onOpenEdit: () => void;
  onCloseEdit: () => void;
  splitOpen: boolean;
  onOpenSplit: () => void;
  onCloseSplit: () => void;
  mergeOpen: boolean;
  onOpenMerge: () => void;
  onCloseMerge: () => void;
  pendingAmbiguousTarget: PendingAmbiguousTarget;
  onSetPendingAmbiguousTarget: (target: PendingAmbiguousTarget) => void;
  onDecide: (decision: CandidateDecision | null, decisionDetail?: CandidateDecisionDetail | null) => void;
  targetChosen: boolean;
  searchTargetElements: (elementType: ElementType, query: string) => Promise<{ elementId: UUID; name: string; parentName: string | null }[] | null>;
}

function attributesRecord(candidate: CaptureCandidate): Record<string, unknown> {
  return candidate.proposal.attributes as Record<string, unknown>;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Turns an attribute key such as `lifecycleStatus` into "Lifecycle status". */
function fieldLabel(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function CaptureCandidateRow({
  candidate,
  mainElementById,
  mainRelationshipById,
  draftElementById,
  canReview,
  selected,
  onSelect,
  multiSelected,
  onToggleMultiSelect,
  editOpen,
  onOpenEdit,
  onCloseEdit,
  splitOpen,
  onOpenSplit,
  onCloseSplit,
  mergeOpen,
  onOpenMerge,
  onCloseMerge,
  pendingAmbiguousTarget,
  onSetPendingAmbiguousTarget,
  onDecide,
  targetChosen,
  searchTargetElements,
}: CaptureCandidateRowProps) {
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeResults, setMergeResults] = useState<{ elementId: UUID; name: string; parentName: string | null }[] | null>(null);

  useEffect(() => {
    if (!mergeOpen || candidate.proposal.kind !== 'element' || candidate.elementType === null) return;
    let cancelled = false;
    const elementType = candidate.elementType;
    searchTargetElements(elementType, mergeQuery)
      .then((results) => {
        if (!cancelled) setMergeResults(results);
      })
      .catch(() => {
        if (!cancelled) setMergeResults(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mergeOpen, mergeQuery, candidate, searchTargetElements]);

  const isInvalidOrUnsourced = candidate.class === 'invalid' || candidate.class === 'unsourced';
  // duplicate_in_target (issue #285, K-8): no delta was ever produced for this candidate (the draft forks
  // from main, which has no such element yet), so there is nothing to accept and nothing to edit — only `r`.
  const isDuplicateInTarget = candidate.class === 'duplicate_in_target';
  const canAccept = candidate.class === 'ambiguous' ? pendingAmbiguousTarget !== null : !isInvalidOrUnsourced && !isDuplicateInTarget;

  const chooseMergeTarget = (target: { elementId: UUID; name: string }) => {
    if (candidate.class === 'ambiguous') onSetPendingAmbiguousTarget(target);
    else onDecide('merged', { intoElementId: target.elementId });
    onCloseMerge();
  };

  const acceptAmbiguous = () => {
    if (pendingAmbiguousTarget === null) return;
    onDecide('accepted', pendingAmbiguousTarget === 'new' ? null : { intoElementId: pendingAmbiguousTarget.elementId });
  };

  const name = candidate.proposal.kind === 'element' ? candidate.proposal.name : null;
  const parentLabel = candidate.proposal.kind === 'element' ? candidateRefLabel(candidate.proposal.parent, mainElementById, draftElementById) : null;
  const fromLabel = candidate.proposal.kind === 'relationship' ? candidateRefLabel(candidate.proposal.from, mainElementById, draftElementById) : null;
  const toLabel = candidate.proposal.kind === 'relationship' ? candidateRefLabel(candidate.proposal.to, mainElementById, draftElementById) : null;
  const mainRow = candidate.draftSubjectId !== null ? (candidate.proposal.kind === 'element' ? mainElementById.get(candidate.draftSubjectId) : mainRelationshipById.get(candidate.draftSubjectId)) : undefined;
  const attributes = attributesRecord(candidate);

  const matchedName = candidate.match.elementId !== undefined ? mainElementById.get(candidate.match.elementId)?.name : undefined;
  // Plain-English description of what the file row was matched to. Never shows the matching method or a score.
  const matchLine =
    candidate.match.level === 'none'
      ? candidate.class === 'invalid' || candidate.class === 'unsourced' ? null : 'Not in the model yet'
      : candidate.match.level === 'name_context' && !(matchedName !== undefined && name !== null && sameName(name, matchedName))
        ? matchedName !== undefined
          ? `Looks like ${matchedName}. Is it the same thing?`
          : 'Looks like something already in the model. Is it the same thing?'
        : matchedName !== undefined
          ? `Already in the model as ${matchedName}`
          : 'Already in the model';

  // Only worth saying when it adds a name the row doesn't already show (its own, or the element it matched).
  const recogniseValues = newAliasValues(
    candidate.aliasProposals.map((a) => a.value),
    [...(name !== null ? [name] : []), ...(matchedName !== undefined ? [matchedName] : [])],
  );

  return (
    <li
      className={[styles.row, selected ? styles.selected : '', isInvalidOrUnsourced || isDuplicateInTarget ? styles.badRow : ''].filter(Boolean).join(' ')}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
    >
      <div className={styles.headerRow}>
        {candidate.proposal.kind === 'element' && candidate.elementType && (name !== null ? <ElementTypeGlyph type={candidate.elementType} label={name} /> : <ElementTypeGlyph type={candidate.elementType} />)}
        <Text as="span" size="lg">
          {candidate.proposal.kind === 'element' ? name : `${candidate.relationshipType ?? ''} · ${fromLabel ?? '?'} → ${toLabel ?? '?'}`}
        </Text>
        {/* PR16: a decided candidate's own state was previously visible only as "the Undo button appeared" — no chip actually named which decision was staged. Reads the same `decision !== null` state the Undo button already keys off (including `confirm`'s own system-default `accepted`, staged before any reviewer acts) rather than also checking `decidedBy` — `stageMany`'s own optimistic local update never sets `decidedBy` (a server-only column), so gating on it would make this chip lag one reload behind every other piece of this row's own feedback. */}
        {candidate.decision !== null && <Chip tone={candidate.decision === 'rejected' ? 'neutral' : 'ok'}>{candidate.decision}</Chip>}
      </div>

      {parentLabel !== null && (
        <Text as="p" tone="muted" size="sm">
          in {parentLabel}
        </Text>
      )}

      {matchLine !== null && (
        <Text as="p" tone="muted" size="sm">
          {matchLine}
        </Text>
      )}

      {candidate.match.similar.length > 0 && (
        <Text as="p" tone="muted" size="sm">
          Also similar to: {candidate.match.similar.map((s) => s.name).join(', ')}
        </Text>
      )}

      {/* §10's `new` row: "the alias proposals that would be recorded" — shown whenever the candidate carries any (a level-2/3 match or an intra-document group can too, §7.6), not only for `new`, so accepting or merging never teaches the matcher something the reviewer wasn't shown first (issue #284). */}
      {recogniseValues.length > 0 && (
        <Text as="p" tone="muted" size="sm">
          {'We\u2019ll recognise'} {recogniseValues.map((value) => `\u201c${value}\u201d`).join(', ')} next time
        </Text>
      )}

      {isInvalidOrUnsourced ? (
        <Text as="p" size="sm">
          {candidate.class === 'invalid' ? candidate.evidence.warnings.map(evidenceWarningLabel).join('; ') || 'This candidate is invalid.' : 'No passage found for this fact in the source.'}
        </Text>
      ) : isDuplicateInTarget ? (
        <Text as="p" size="sm">
          This matches something already proposed on the target change — not yet on main, so it can&rsquo;t be accepted from here without creating a duplicate. Reject this candidate, or reconcile it from the target change directly.
        </Text>
      ) : candidate.class === 'gone' ? (
        <Text as="p" size="sm">
          Present in a previous run, absent from this document.
        </Text>
      ) : candidate.class === 'update' || candidate.class === 'conflict' ? (
        <div className={candidate.class === 'conflict' ? styles.attributeColumnsThree : styles.attributeColumns}>
          {Object.entries(attributes).map(([key, value]) => {
            const mainValue = (mainRow?.attributes as Record<string, unknown> | undefined)?.[key];
            if (JSON.stringify(mainValue) === JSON.stringify(value)) return null;
            return (
              <div key={key} className={styles.attributeRow}>
                <Text as="span" size="sm">
                  {fieldLabel(key)}
                </Text>
                <Text as="span" size="sm" tone="muted">
                  Now: {formatValue(mainValue)}
                </Text>
                <Text as="span" size="sm">
                  From the file: {formatValue(value)}
                </Text>
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          {Object.entries(attributes).map(([key, value]) => (
            <div key={key} className={styles.attributeRow}>
              <Text as="span" size="sm">
                {fieldLabel(key)}
              </Text>
              <Text as="span" size="sm">
                {formatValue(value)}
              </Text>
            </div>
          ))}
        </div>
      )}

      {candidate.evidence.warnings.length > 0 && !isInvalidOrUnsourced && !isDuplicateInTarget && (
        <div className={styles.warnings}>
          {candidate.evidence.warnings.map((w, i) => (
            <Chip key={i} tone="warn">
              {evidenceWarningLabel(w)}
            </Chip>
          ))}
        </div>
      )}

      {/* Reported: this is the document text being *analysed*, not the
          candidate's own content — a reviewer usually only needs the source
          ref for context, and the passage itself (which can run to several
          hundred words, e.g. a wide table row's own extraction) only when
          actually checking a fact. Collapsed by default, same disclosure
          mechanism every other section in this app already uses (no
          separate "show/hide" control invented for this one case) — the
          source ref stays visible in the header either way. */}
      <CollapsibleSection title="Where this came from" meta={formatSourceRef(candidate.evidence.sourceRef)} defaultOpen={false}>
        <Text as="p" size="sm" mono>
          {candidate.evidence.passage}
        </Text>
      </CollapsibleSection>

      {canReview && candidate.class === 'ambiguous' && (
        <div className={styles.candidateList}>
          {(candidate.match.ambiguous ?? []).map((m, i) => (
            <Button
              key={m.elementId}
              variant={pendingAmbiguousTarget !== 'new' && pendingAmbiguousTarget?.elementId === m.elementId ? 'primary' : 'secondary'}
              onClick={(e) => {
                e.stopPropagation();
                onSetPendingAmbiguousTarget({ elementId: m.elementId, name: m.name });
              }}
            >
              {i + 1}. {m.name}
              {m.parentName ? ` (in ${m.parentName})` : ''} — {m.score.toFixed(2)}
            </Button>
          ))}
          <Button
            variant={pendingAmbiguousTarget === 'new' ? 'primary' : 'ghost'}
            onClick={(e) => {
              e.stopPropagation();
              onSetPendingAmbiguousTarget('new');
            }}
          >
            n. None of these. Add it as new.
          </Button>
        </div>
      )}

      {canReview && (
        <div className={styles.actions}>
          {/* An item that is already up to date has nothing to accept or reject: it is only here to be seen (and, in bulk, via Select). */}
          {candidate.class !== 'confirm' && (
            <>
              <Button
                variant="primary"
                disabled={!canAccept}
                onClick={
                  candidate.class === 'ambiguous'
                    ? acceptAmbiguous
                    : () => {
                        onDecide('accepted');
                      }
                }
              >
                {candidate.class === 'update' || candidate.class === 'conflict' ? "Use the file's version" : candidate.class === 'new' ? 'Add' : 'Accept'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  onDecide('rejected');
                }}
              >
                {candidate.class === 'conflict' || candidate.class === 'update' ? 'Keep what we have' : candidate.class === 'gone' ? 'Ignore' : candidate.class === 'new' ? "Don't add" : 'Reject'}
              </Button>
            </>
          )}
          {candidate.decision !== null && candidate.class !== 'confirm' && (
            <Button
              variant="ghost"
              onClick={() => {
                onDecide(null, null);
              }}
            >
              Undo
            </Button>
          )}
          {!isDuplicateInTarget && candidate.class !== 'confirm' && (
            <Button variant="ghost" onClick={editOpen ? onCloseEdit : onOpenEdit}>
              {isInvalidOrUnsourced ? 'Edit…' : 'Edit'}
            </Button>
          )}
          {(candidate.class === 'new' || candidate.class === 'update') && (
            <Button variant="ghost" onClick={splitOpen ? onCloseSplit : onOpenSplit}>
              Split
            </Button>
          )}
          {(candidate.class === 'new' || candidate.class === 'ambiguous') && (
            <Button variant="ghost" disabled={!targetChosen} title={targetChosen ? undefined : 'Pick an existing change in “Add to” to merge into something already proposed there'} onClick={mergeOpen ? onCloseMerge : onOpenMerge}>
              Merge into…
            </Button>
          )}
          {(candidate.class === 'confirm' || candidate.class === 'new') && (
            <label className={styles.panelRow}>
              <input type="checkbox" checked={multiSelected} onChange={onToggleMultiSelect} />
              <Text as="span" size="sm">
                Select
              </Text>
            </label>
          )}
        </div>
      )}

      {canReview && editOpen && (
        <div className={styles.panel}>
          {isInvalidOrUnsourced ? (
            <Text as="p" size="sm">
              Editing a {candidate.class} candidate needs the source document re-checked for a real passage — not supported here yet. Reject this candidate, or fix the source and run capture again.
            </Text>
          ) : (
            <CaptureEditPanel
              candidate={candidate}
              onSubmit={(editedAttributes) => {
                onDecide('edited', { attributes: editedAttributes });
                onCloseEdit();
              }}
              onCancel={onCloseEdit}
            />
          )}
        </div>
      )}

      {canReview && splitOpen && (
        <div className={styles.panel}>
          <CaptureSplitPanel
            candidate={candidate}
            onSubmit={(acceptedAttributes) => {
              onDecide('split', { acceptedAttributes });
              onCloseSplit();
            }}
            onCancel={onCloseSplit}
          />
        </div>
      )}

      {canReview && mergeOpen && (
        <div className={styles.panel}>
          <input
            className={styles.input}
            placeholder="Search for an existing element…"
            value={mergeQuery}
            onChange={(e) => {
              setMergeQuery(e.target.value);
            }}
          />
          <ul className={styles.candidateList}>
            {(mergeResults ?? []).map((m) => (
              <li key={m.elementId}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    chooseMergeTarget(m);
                  }}
                >
                  {m.name}
                  {m.parentName ? ` (in ${m.parentName})` : ''}
                </Button>
              </li>
            ))}
            {mergeResults !== null && mergeResults.length === 0 && (
              <Text as="p" tone="muted" size="sm">
                No matches.
              </Text>
            )}
          </ul>
          <Button variant="ghost" onClick={onCloseMerge}>
            Cancel
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * `e` — a value per attribute (SPEC §10). Mounted fresh every time
 * `editOpen` flips true (the caller's own `{editOpen && <CaptureEditPanel .../>}`),
 * so its own local field state is seeded once, via a lazy `useState`
 * initializer, with no effect needed to "reset on open."
 */
function CaptureEditPanel({ candidate, onSubmit, onCancel }: { candidate: CaptureCandidate; onSubmit: (attributes: Record<string, unknown>) => void; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const [key, value] of Object.entries(attributesRecord(candidate))) seed[key] = typeof value === 'string' ? value : JSON.stringify(value);
    return seed;
  });

  const submit = () => {
    const attributes: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(values)) {
      try {
        attributes[key] = JSON.parse(raw) as unknown;
      } catch {
        attributes[key] = raw;
      }
    }
    onSubmit(attributes);
  };

  return (
    <>
      {Object.keys(values).map((key) => (
        <div key={key} className={styles.panelRow}>
          <Text as="span" size="sm" mono>
            {key}
          </Text>
          <input
            className={styles.input}
            value={values[key] ?? ''}
            onChange={(e) => {
              setValues((prev) => ({ ...prev, [key]: e.target.value }));
            }}
          />
        </div>
      ))}
      <div className={styles.panelRow}>
        <Button variant="primary" onClick={submit}>
          Save edit
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

/** `s` — which attributes to accept (SPEC §10). Same fresh-mount-per-open shape as `CaptureEditPanel`. */
function CaptureSplitPanel({ candidate, onSubmit, onCancel }: { candidate: CaptureCandidate; onSubmit: (acceptedAttributes: string[]) => void; onCancel: () => void }) {
  const attributes = attributesRecord(candidate);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set(Object.keys(attributes)));

  return (
    <>
      {Object.keys(attributes).map((key) => (
        <label key={key} className={styles.panelRow}>
          <input
            type="checkbox"
            checked={selectedKeys.has(key)}
            onChange={(e) => {
              setSelectedKeys((prev) => {
                const next = new Set(prev);
                if (e.target.checked) next.add(key);
                else next.delete(key);
                return next;
              });
            }}
          />
          <Text as="span" size="sm" mono>
            {key}
          </Text>
          <Text as="span" size="sm">
            {formatValue(attributes[key])}
          </Text>
        </label>
      ))}
      <div className={styles.panelRow}>
        <Button
          variant="primary"
          onClick={() => {
            onSubmit([...selectedKeys]);
          }}
        >
          Accept selected attributes
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}
