import { useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { DECISION_CRITERIA, DECISION_RATING_LEVELS, decisionRatingLevelTone, type DecisionCriterionKey, type DecisionRatingLevel } from '../../contracts/decisionCriteria';
import type { BranchStatus, DecisionOptionRatingRow } from '../../db/types';
import { branchStatusTone } from '../changes/branchStatus';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import { useDecisionRatings } from './useDecisionRatings';
import styles from './DecisionCriteriaGrid.module.css';

export interface DecisionCriteriaOption {
  branchId: UUID;
  /** `intentHeaderLine(branch)` — may carry the "Exploring: " prefix this grid's own header strips before display (rule: "merge Options list into column headers... drop 'Exploring:' prefix"). */
  label: string;
  status: BranchStatus;
  isChosen: boolean;
  /** One-line derived summary of what this option does vs main ("Retires PM, adds Hana equivalent, re-points 4 flows"), or `null` for an empty-delta option — this header column renders muted and shows "No changes recorded yet" instead (decision 3, the sprint's own go-ahead). */
  summary: string | null;
  canChoose: boolean;
}

export interface DecisionCriteriaGridProps {
  modelId: UUID;
  decisionId: UUID;
  options: DecisionCriteriaOption[];
  /** `canRateDecisionOption` at the call site — decision-status-and-role gated, same as `canAddOption`/`canChoose`. `false` renders every cell read-only, with no tap affordance at all (the grid at time-of-choosing still needs to render, just never editable). */
  canRate: boolean;
  userId: UUID | null;
  /** The decision's own needed-by date, shown beside the Timing row (rule 5) — `null` when the decision never recorded one. */
  neededBy: string | null;
  orgSlug: string;
  modelSlug: string;
  onChoose: (branchId: UUID) => void;
  /** `canCreateChangeBranch(role)` at the call site, ungated by `decision.status` (unlike `canAddOption`/`canChoose`) — this action is only ever offered on the *chosen* option, which by definition means the decision has already moved past `proposed`. */
  canWorkOnChange: boolean;
  /** Selects this branch as the session's editing ref and navigates to its change page — the exact "Edit in this change" mechanism `ChangePage.tsx` already offers, reused rather than reinvented (item 5: "using the existing 'Work in this change' flow"). */
  onWorkOnThisChange: (branchId: UUID) => void;
}

interface EditingCell {
  branchId: UUID;
  branchLabel: string;
  criterion: DecisionCriterionKey;
  criterionLabel: string;
}

const EXPLORING_PREFIX = /^Exploring:\s*/;

function stripExploringPrefix(label: string): string {
  return label.replace(EXPLORING_PREFIX, '');
}

/**
 * The judgement-criteria grid above the structural "What changes" table
 * (the decision-criteria-ratings brief's own rule 1/5) — one row per
 * `DECISION_CRITERIA` entry, one column per linked option. F6.3 (Part B)
 * folded the old separate "Options" list into this grid's own column
 * headers: name (prefix stripped), status, "View diagram", "Choose", a
 * compact rated-count fraction, and the option's own one-line change
 * summary — options no longer appear twice on the page. Editing still
 * happens in one shared panel below the grid (mirroring `DecisionView.tsx`'s
 * own "Choose" confirm form, not a per-cell popover) so the editor never
 * has to fit inside a narrow table cell at the ~380px width this sprint's
 * own constraint names.
 *
 * Decision-side-completion item 5: once an option is chosen (and still a
 * `draft` branch — the only status a change branch is ever committable
 * to, same guard `ChangePage.tsx`'s own "Edit in this change" uses), its
 * header also offers "Work on this as a change" — no new mechanism, just
 * `onWorkOnThisChange` selecting the branch as the session's editing ref
 * and navigating to its change page, the exact same thing `ChangePage.tsx`'s
 * own button does. `atlas.choose_decision_option` already flips the chosen
 * branch's `intent` to `propose` server-side at Choose time — this action
 * only ever gets the person *into* the change workspace, never repeats
 * that flip.
 */
export function DecisionCriteriaGrid({ modelId, decisionId, options, canRate, userId, neededBy, orgSlug, modelSlug, onChoose, canWorkOnChange, onWorkOnThisChange }: DecisionCriteriaGridProps) {
  const ratingsState = useDecisionRatings(modelId, decisionId);
  const ratings = ratingsState.ratings;
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [levelDraft, setLevelDraft] = useState<DecisionRatingLevel | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  if (options.length === 0) return null;

  function ratingFor(branchId: UUID, criterion: DecisionCriterionKey): DecisionOptionRatingRow | undefined {
    return ratings.find((r) => r.branch_id === branchId && r.criterion === criterion);
  }

  function ratedCount(branchId: UUID): number {
    return ratings.filter((r) => r.branch_id === branchId).length;
  }

  function openEditor(branchId: UUID, branchLabel: string, criterion: DecisionCriterionKey, criterionLabel: string) {
    if (!canRate) return;
    const existing = ratingFor(branchId, criterion);
    setEditing({ branchId, branchLabel, criterion, criterionLabel });
    setLevelDraft(existing?.level ?? null);
    setNoteDraft(existing?.note ?? '');
  }

  async function saveRating() {
    if (!editing || !levelDraft || !userId) return;
    const saved = await ratingsState.rateOption({ decisionId, branchId: editing.branchId, criterion: editing.criterion, level: levelDraft, note: noteDraft, userId });
    if (saved) setEditing(null);
  }

  return (
    <div className={styles.wrap} data-testid="decision-criteria-grid">
      <div className={styles.tableWrap}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th className={styles.criterionHeaderCell} />
              {options.map((o) => (
                <th key={o.branchId} className={o.summary === null ? styles.mutedHeaderCell : undefined}>
                  <div className={styles.optionHeader}>
                    <div className={styles.optionHeaderTop}>
                      {o.isChosen && <Chip tone="ok">chosen</Chip>}
                      <Chip tone={branchStatusTone(o.status)}>{o.status}</Chip>
                    </div>
                    <Link to={`/o/${orgSlug}/m/${modelSlug}/changes/${o.branchId}`}>
                      <Text as="span" size="md">
                        {stripExploringPrefix(o.label)}
                      </Text>
                    </Link>
                    <Text as="p" size="sm" tone={o.summary === null ? 'muted' : 'default'}>
                      {o.summary ?? 'No changes recorded yet'}
                    </Text>
                    <div className={styles.optionHeaderActions}>
                      <Link to={`/o/${orgSlug}/m/${modelSlug}/decisions/${decisionId}/options/${o.branchId}/landscape`}>
                        <Text as="span" size="sm">
                          View diagram →
                        </Text>
                      </Link>
                      {o.canChoose && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            onChoose(o.branchId);
                          }}
                        >
                          Choose
                        </Button>
                      )}
                      {o.isChosen && canWorkOnChange && o.status === 'draft' && (
                        <Button
                          variant="primary"
                          onClick={() => {
                            onWorkOnThisChange(o.branchId);
                          }}
                        >
                          Work on this as a change
                        </Button>
                      )}
                    </div>
                    <Text as="span" size="sm" tone="muted">
                      {ratedCount(o.branchId)}/{DECISION_CRITERIA.length}
                    </Text>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DECISION_CRITERIA.map((criterion) => (
              <tr key={criterion.key}>
                <td className={styles.criterionLabel}>
                  {criterion.label}
                  {criterion.key === 'timing' && neededBy !== null && (
                    <Text as="span" size="sm" tone="muted">
                      {' '}
                      (needed by {neededBy})
                    </Text>
                  )}
                </td>
                {options.map((o) => {
                  const rating = ratingFor(o.branchId, criterion.key);
                  return (
                    <td key={o.branchId}>
                      <button
                        type="button"
                        className={styles.cell}
                        disabled={!canRate}
                        onClick={() => {
                          openEditor(o.branchId, stripExploringPrefix(o.label), criterion.key, criterion.label);
                        }}
                      >
                        {rating ? <Chip tone={decisionRatingLevelTone(rating.level)}>{criterion.levelLabels[rating.level]}</Chip> : <span className={styles.notRated}>Not rated</span>}
                        {rating?.note && (
                          <span className={styles.noteDot} aria-label="Has a note" title={rating.note}>
                            •
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className={styles.editor} data-testid="decision-rating-editor">
          <Text as="h3" size="sm">
            {editing.criterionLabel} — {editing.branchLabel}
          </Text>
          <div className={styles.levelPicker}>
            {DECISION_RATING_LEVELS.map((level) => {
              const label = DECISION_CRITERIA.find((c) => c.key === editing.criterion)?.levelLabels[level] ?? level;
              const selected = levelDraft === level;
              return (
                <button
                  key={level}
                  type="button"
                  className={[styles.levelOption, selected ? styles.levelOptionSelected : ''].filter(Boolean).join(' ')}
                  aria-pressed={selected}
                  onClick={() => {
                    setLevelDraft(level);
                  }}
                >
                  <Chip tone={decisionRatingLevelTone(level)}>{label}</Chip>
                </button>
              );
            })}
          </div>
          <Text as="label" size="sm" tone="muted">
            Note (optional)
          </Text>
          <textarea
            className={styles.noteInput}
            maxLength={200}
            placeholder="A short reason for this rating"
            value={noteDraft}
            onChange={(e) => {
              setNoteDraft(e.target.value);
            }}
          />
          <div className={styles.editorActions}>
            <Button variant="primary" disabled={!levelDraft || ratingsState.status === 'saving'} onClick={() => void saveRating()}>
              {ratingsState.status === 'saving' ? 'Saving…' : 'Save rating'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {ratingsState.error !== null && <Text as="p">{ratingsState.error}</Text>}
        </div>
      )}
    </div>
  );
}
