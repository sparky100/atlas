import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { DECISION_CRITERIA, DECISION_RATING_LEVELS, decisionRatingLevelTone, type DecisionCriterionKey, type DecisionRatingLevel } from '../../contracts/decisionCriteria';
import type { DecisionOptionRatingRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import { useDecisionRatings } from './useDecisionRatings';
import styles from './DecisionCriteriaGrid.module.css';

export interface DecisionCriteriaOption {
  branchId: UUID;
  label: string;
}

export interface DecisionCriteriaGridProps {
  modelId: UUID;
  decisionId: UUID;
  options: DecisionCriteriaOption[];
  /** `canRateDecisionOption` at the call site — decision-status-and-role gated, same as `canAddOption`/`canChoose`. `false` renders every cell read-only, with no tap affordance at all (the grid at time-of-choosing still needs to render, just never editable). */
  canRate: boolean;
  userId: UUID | null;
}

interface EditingCell {
  branchId: UUID;
  branchLabel: string;
  criterion: DecisionCriterionKey;
  criterionLabel: string;
}

/**
 * The judgement-criteria grid above the structural "What changes" table
 * (the decision-criteria-ratings brief's own rule 1/5) — one row per
 * `DECISION_CRITERIA` entry, one column per linked option. A cell is a
 * single tap target; editing happens in one shared panel below the grid
 * (mirroring `DecisionView.tsx`'s own "Choose" confirm form, not a
 * per-cell popover) so the editor never has to fit inside a narrow table
 * cell at the ~380px width this sprint's own constraint names.
 */
export function DecisionCriteriaGrid({ modelId, decisionId, options, canRate, userId }: DecisionCriteriaGridProps) {
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
    <div className={styles.wrap}>
      <div className={styles.progressRow}>
        {options.map((o) => (
          <Text key={o.branchId} as="span" size="sm" tone="muted">
            {o.label}: {ratedCount(o.branchId)} of {DECISION_CRITERIA.length} rated
          </Text>
        ))}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th>Criterion</th>
              {options.map((o) => (
                <th key={o.branchId}>{o.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DECISION_CRITERIA.map((criterion) => (
              <tr key={criterion.key}>
                <td className={styles.criterionLabel}>{criterion.label}</td>
                {options.map((o) => {
                  const rating = ratingFor(o.branchId, criterion.key);
                  return (
                    <td key={o.branchId}>
                      <button
                        type="button"
                        className={styles.cell}
                        disabled={!canRate}
                        onClick={() => {
                          openEditor(o.branchId, o.label, criterion.key, criterion.label);
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
