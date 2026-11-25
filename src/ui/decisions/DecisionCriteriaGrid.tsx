import { useState } from 'react';
import type { OptionApproach } from '../../contracts/optionApproach';
import { OptionApproachLabel } from './OptionApproach';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { DECISION_CRITERIA, DECISION_RATING_LEVELS, decisionRatingLevelTone, type DecisionCriterionKey, type DecisionRatingLevel } from '../../contracts/decisionCriteria';
import type { BranchStatus, DecisionOptionRatingRow } from '../../db/types';
import { branchStatusTone } from '../changes/branchStatus';
import { ElementNamedText } from '../changes/ElementNamedText';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { ClampedText } from '../components/ClampedText/ClampedText';
import { Text } from '../components/Text/Text';
import { OptionSources } from './OptionSources';
import { stripIntentPrefix } from './optionLabel';
import type { OptionSource } from '../../contracts/optionSource';
import type { UseDecisionRatingsResult } from './useDecisionRatings';
import styles from './DecisionCriteriaGrid.module.css';
import { useCompactDecisionLayout } from './useCompactDecisionLayout';

export interface DecisionCriteriaOption {
  /** The stable candidate identity. Ratings and sources now resolve through this. */
  optionId: UUID;
  /** The delivery change, when this candidate has one. A candidate with no branch renders read-only, with no change-page link. */
  branchId: UUID | null;
  /**
   * The option's own name, not a branch intent line. Older branch labels may
   * still carry "Exploring: "/"Proposing: " prefixes, so the grid strips them.
   */
  label: string;
  status: BranchStatus;
  /** The word shown for a candidate with no branch: "candidate" while open, "not chosen" once the decision is closed. */
  statusLabel?: string | undefined;
  isChosen: boolean;
  /** One-line derived summary of what this option does vs main ("Retires PM, adds Hana equivalent, re-points 4 flows"), or `null` for an empty-delta option — this header column renders muted and shows "No changes recorded yet" instead (decision 3, the sprint's own go-ahead). */
  summary: string | null;
  canChoose: boolean;
  /** The option's own plain description (what the person or the Designer wrote about it), shown under its name. */
  description?: string | null;
  /** Catalogue citations saved when this option was added. Absent or empty prints no sources block. */
  sources?: readonly OptionSource[];
  /** Where the option came from when an agent suggested it, e.g. "Suggested by the Designer, edited by Priya". `null` for an option someone added by hand. */
  provenance?: string | null;
  /** What kind of option this is (`decision_options.approach`); `null` = not decided yet. */
  approach: OptionApproach | null;
}

export interface DecisionCriteriaGridProps {
  decisionId: UUID;
  options: DecisionCriteriaOption[];
  /** `canRateDecisionOption` at the call site — decision-status-and-role gated, same as `canAddOption`/`canChoose`. `false` renders every cell read-only, with no tap affordance at all (the grid at time-of-choosing still needs to render, just never editable). */
  canRate: boolean;
  userId: UUID | null;
  /** The decision's own needed-by date, shown beside the Timing row (rule 5) — `null` when the decision never recorded one. */
  neededBy: string | null;
  orgSlug: string;
  modelSlug: string;
  /** The model's head commit, used to read the names of elements an older saved description still cites. */
  commitId?: UUID | null;
  onChoose: (optionId: UUID, branchId: UUID | null) => void;
  /** Shown above the grid when this person cannot choose (not an owner or architect), so a missing Choose button is explained. `null` when they can, or the decision is no longer open. */
  chooseNote?: string | null;
  /** `canCreateChangeBranch(role)` at the call site, ungated by `decision.status` (unlike `canAddOption`/`canChoose`) - this action is only ever offered on the *chosen* option, which by definition means the decision has already moved past `proposed`. */
  canWorkOnChange: boolean;
  /** The decision is still proposed and the viewer may create a branch for a candidate. */
  canWorkOnCandidate: boolean;
  /** The organisations's guarded web research is on, the decision is proposed and the caller may contribute. */
  canResearch: boolean;
  /** Opens the Researcher for this option; the label is the person-facing option name shown in the dialog. */
  /** Research any candidate, whether or not it has a change yet. */
  onResearch: (optionId: UUID, branchId: UUID | null, label: string) => void;
  /** Selects this branch as the session's editing ref and navigates to its change page - the exact "Edit in this change" mechanism `ChangePage.tsx` already offers, reused rather than reinvented (item 5: "using the existing 'Work in this change' flow"). */
  onWorkOnThisChange: (branchId: UUID) => void;
  /** Creates the delivery branch for a candidate that has none yet, then opens it. */
  onWorkOnOption: (optionId: UUID) => void;
  /** The viewer may change what kind of option each one is (proposed decision, contributor or above). */
  canSetApproach: boolean;
  /** Saves a new approach for one option. */
  onSetApproach: (optionId: UUID, approach: OptionApproach | null) => void;
  /**
   * Lifted from `DecisionView.tsx` (decision-side-completion item 6) rather
   * than this component calling `useDecisionRatings` itself — the ADR
   * export needs every option's own ratings too, and a second independent
   * `useDecisionRatings` instance there would mean two separate fetches
   * plus two separate 45s quiet-refetch polling loops for the same table.
   * One hook instance, owned by the page, passed down here unchanged.
   */
  ratingsState: UseDecisionRatingsResult;
}

interface EditingCell {
  optionId: UUID;
  branchId: UUID | null;
  branchLabel: string;
  criterion: DecisionCriterionKey;
  criterionLabel: string;
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
 * header also offers "Work on this option" — no new mechanism, just
 * `onWorkOnThisChange` selecting the branch as the session's editing ref
 * and navigating to its change page, the exact same thing `ChangePage.tsx`'s
 * own button does. `atlas.choose_decision_option` already flips the chosen
 * branch's `intent` to `propose` server-side at Choose time — this action
 * only ever gets the person *into* the change workspace, never repeats
 * that flip.
 */
export function DecisionCriteriaGrid({ decisionId, options, canRate, userId, neededBy, orgSlug, modelSlug, commitId, onChoose, chooseNote, canWorkOnChange, canWorkOnCandidate, onWorkOnThisChange, onWorkOnOption, canSetApproach, onSetApproach, canResearch, onResearch, ratingsState }: DecisionCriteriaGridProps) {
  const ratings = ratingsState.ratings;
  const compact = useCompactDecisionLayout();
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [levelDraft, setLevelDraft] = useState<DecisionRatingLevel | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  if (options.length === 0) return null;

  /** An option is backed by a change when it has a branch; while it is still a draft and the person may work on changes they can open it for editing, chosen or not. A candidate with no branch has nothing to open yet. The chosen option keeps its own "Work on this option" action. */
  function canEditOption(o: DecisionCriteriaOption): boolean {
    return o.branchId !== null && canWorkOnChange && o.status === 'draft' && !o.isChosen;
  }

  function optionStatusLabel(o: DecisionCriteriaOption): string {
    return o.branchId === null ? (o.statusLabel ?? 'candidate') : o.status;
  }

  function optionStatusTone(o: DecisionCriteriaOption): 'neutral' | 'danger' | ReturnType<typeof branchStatusTone> {
    if (o.branchId !== null) return branchStatusTone(o.status);
    return o.statusLabel === 'cancelled' ? 'danger' : 'neutral';
  }

  /** Read through the stable option id; fall back to the legacy branch key only for a row not yet backfilled. */
  function ratingFor(o: DecisionCriteriaOption, criterion: DecisionCriterionKey): DecisionOptionRatingRow | undefined {
    return ratings.find((r) => (r.option_id === o.optionId || (r.option_id == null && o.branchId !== null && r.branch_id === o.branchId)) && r.criterion === criterion);
  }

  function ratedCount(o: DecisionCriteriaOption): number {
    return ratings.filter((r) => r.option_id === o.optionId || (r.option_id == null && o.branchId !== null && r.branch_id === o.branchId)).length;
  }

  function openEditor(o: DecisionCriteriaOption, criterion: DecisionCriterionKey, criterionLabel: string) {
    if (!canRate) return;
    const existing = ratingFor(o, criterion);
    setEditing({ optionId: o.optionId, branchId: o.branchId, branchLabel: stripIntentPrefix(o.label), criterion, criterionLabel });
    setLevelDraft(existing?.level ?? null);
    setNoteDraft(existing?.note ?? '');
  }

  async function saveRating() {
    if (!editing || !levelDraft || !userId) return;
    const saved = await ratingsState.rateOption({ decisionId, branchId: editing.branchId, optionId: editing.optionId, criterion: editing.criterion, level: levelDraft, note: noteDraft, userId });
    if (saved) setEditing(null);
  }

  function renderRatingEditor() {
    if (!editing) return null;
    return (
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
    );
  }

  return (
    <div className={styles.wrap} data-testid="decision-criteria-grid">
      {chooseNote !== undefined && chooseNote !== null && (
        <Text as="p" size="sm" tone="muted" data-testid="choose-note">
          {chooseNote}
        </Text>
      )}
      {!compact && <div className={styles.tableWrap}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th className={styles.criterionHeaderCell}>
                <Text as="span" size="sm" tone="muted">
                  How the options compare
                </Text>
              </th>
              {options.map((o) => {
                const branchId = o.branchId;
                return (
                <th key={o.optionId} className={o.summary === null ? styles.mutedHeaderCell : undefined}>
                  <div className={styles.optionHeader}>
                    <div className={styles.optionHeaderTop}>
                      {o.isChosen && <Chip tone="ok">chosen</Chip>}
                      <Chip tone={optionStatusTone(o)}>{optionStatusLabel(o)}</Chip>
                    </div>
                    <OptionApproachLabel approach={o.approach} optionTitle={stripIntentPrefix(o.label)} canEdit={canSetApproach} onChange={(approach) => { onSetApproach(o.optionId, approach); }} />
                    {o.branchId !== null ? (
                      <Link to={`/o/${orgSlug}/m/${modelSlug}/changes/${o.branchId}`}>
                        <Text as="span" size="md" className={styles.optionTitle}>
                          {stripIntentPrefix(o.label)}
                        </Text>
                      </Link>
                    ) : (
                      <Text as="span" size="md" className={styles.optionTitle}>
                        {stripIntentPrefix(o.label)}
                      </Text>
                    )}
                    {o.provenance != null && <Chip tone="info">{o.provenance}</Chip>}
                    {o.description != null && o.description.trim() !== '' && (
                      <Text as="div" size="sm">
                        <ClampedText text={o.description}>
                          <ElementNamedText text={o.description} commitId={commitId ?? null} />
                        </ClampedText>
                      </Text>
                    )}
                    <Text as="p" size="sm" tone={o.summary === null ? 'muted' : 'default'}>
                      {o.summary ?? 'No changes recorded yet'}
                    </Text>
                    <OptionSources sources={o.sources ?? []} />
                    {o.summary === null && canEditOption(o) && (
                      <Text as="p" size="sm" tone="muted">
                        Use Work on this option to draft it.
                      </Text>
                    )}
                    {branchId === null && canWorkOnCandidate && (
                      <Text as="p" size="sm" tone="muted">
                        Use Work on this option to draft it.
                      </Text>
                    )}
                    <div className={styles.optionHeaderActions}>
                      {canResearch && (
                        <Button variant="secondary" onClick={() => { onResearch(o.optionId, branchId, stripIntentPrefix(o.label)); }}>
                          Research the web
                        </Button>
                      )}
                      {branchId !== null && (
                        <Link to={`/o/${orgSlug}/m/${modelSlug}/decisions/${decisionId}/options/${branchId}/landscape`}>
                          <Text as="span" size="sm">
                            Preview impact →
                          </Text>
                        </Link>
                      )}
                      {branchId === null && canWorkOnCandidate && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            onWorkOnOption(o.optionId);
                          }}
                        >
                          Work on this option
                        </Button>
                      )}
                      {canEditOption(o) && branchId !== null && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            onWorkOnThisChange(branchId);
                          }}
                        >
                          Work on this option
                        </Button>
                      )}
                      {o.canChoose && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            onChoose(o.optionId, branchId);
                          }}
                        >
                          Choose
                        </Button>
                      )}
                      {o.isChosen && canWorkOnChange && o.status === 'draft' && branchId !== null && (
                        <Button
                          variant="primary"
                          onClick={() => {
                            onWorkOnThisChange(branchId);
                          }}
                        >
                          Work on this option
                        </Button>
                      )}
                    </div>
                    <Text as="span" size="sm" tone="muted">
                      {ratedCount(o)}/{DECISION_CRITERIA.length}
                    </Text>
                  </div>
                </th>
                );
              })}
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
                  const rating = ratingFor(o, criterion.key);
                  return (
                    <td key={o.optionId}>
                      <button
                        type="button"
                        className={styles.cell}
                        disabled={!canRate}
                        onClick={() => {
                          openEditor(o, criterion.key, criterion.label);
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
      </div>}

      {compact && <div className={styles.mobileCards} data-testid="decision-option-cards">
        {options.map((o) => {
          const branchId = o.branchId;
          return (
          <article key={o.optionId} className={styles.optionCard} data-testid="decision-option-card" aria-label={stripIntentPrefix(o.label)}>
            <div className={styles.optionHeaderTop}>
              {o.isChosen && <Chip tone="ok">chosen</Chip>}
              <Chip tone={optionStatusTone(o)}>{optionStatusLabel(o)}</Chip>
              <Text as="span" size="sm" tone="muted">{ratedCount(o)}/{DECISION_CRITERIA.length} rated</Text>
            </div>
            <OptionApproachLabel approach={o.approach} optionTitle={stripIntentPrefix(o.label)} canEdit={canSetApproach} onChange={(approach) => { onSetApproach(o.optionId, approach); }} />
            {branchId !== null ? (
              <Link to={`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`}>
                <Text as="span" size="md" className={styles.optionTitle}>{stripIntentPrefix(o.label)}</Text>
              </Link>
            ) : (
              <Text as="span" size="md" className={styles.optionTitle}>{stripIntentPrefix(o.label)}</Text>
            )}
            {o.provenance != null && <Text as="p" size="sm" tone="muted">{o.provenance}</Text>}
            <Text as="p" size="sm" tone={o.summary === null ? 'muted' : 'default'}>{o.summary ?? 'No changes recorded yet'}</Text>
            {branchId === null && canWorkOnCandidate && <Text as="p" size="sm" tone="muted">Use Work on this option to draft it.</Text>}
            {((o.description?.trim() ?? '') !== '' || (o.sources?.length ?? 0) > 0) && (
              <details className={styles.optionDetails}>
                <summary>Details and evidence</summary>
                {o.description?.trim() && <Text as="div" size="sm"><ClampedText text={o.description}><ElementNamedText text={o.description} commitId={commitId ?? null} /></ClampedText></Text>}
                <OptionSources sources={o.sources ?? []} />
              </details>
            )}
            <div className={styles.ratingList}>
              {DECISION_CRITERIA.map((criterion) => {
                const rating = ratingFor(o, criterion.key);
                return (
                  <div key={criterion.key} className={styles.ratingRow} data-testid={`decision-rating-${criterion.key}`}>
                    <Text as="span" size="sm">{criterion.label}{criterion.key === 'timing' && neededBy !== null ? ` (needed by ${neededBy})` : ''}</Text>
                    <button type="button" className={styles.cell} disabled={!canRate} onClick={() => { openEditor(o, criterion.key, criterion.label); }}>
                      {rating ? <Chip tone={decisionRatingLevelTone(rating.level)}>{criterion.levelLabels[rating.level]}</Chip> : <span className={styles.notRated}>Not rated</span>}
                      {rating?.note && <span className={styles.noteDot} aria-label="Has a note" title={rating.note}>•</span>}
                    </button>
                    {editing?.optionId === o.optionId && editing.criterion === criterion.key && renderRatingEditor()}
                  </div>
                );
              })}
            </div>
            <div className={styles.optionHeaderActions}>
              {canResearch && <Button variant="secondary" onClick={() => { onResearch(o.optionId, branchId, stripIntentPrefix(o.label)); }}>Research the web</Button>}
              {branchId !== null && <Link to={`/o/${orgSlug}/m/${modelSlug}/decisions/${decisionId}/options/${branchId}/landscape`}>Preview impact →</Link>}
              {branchId === null && canWorkOnCandidate && <Button variant="secondary" onClick={() => { onWorkOnOption(o.optionId); }}>Work on this option</Button>}
              {canEditOption(o) && branchId !== null && <Button variant="secondary" onClick={() => { onWorkOnThisChange(branchId); }}>Work on this option</Button>}
              {o.canChoose && <Button variant="secondary" onClick={() => { onChoose(o.optionId, branchId); }}>Choose</Button>}
              {o.isChosen && canWorkOnChange && o.status === 'draft' && branchId !== null && <Button variant="primary" onClick={() => { onWorkOnThisChange(branchId); }}>Work on this option</Button>}
            </div>
          </article>
          );
        })}
      </div>}
      {!compact && editing && <div className={styles.desktopEditor}>{renderRatingEditor()}</div>}
    </div>
  );
}
