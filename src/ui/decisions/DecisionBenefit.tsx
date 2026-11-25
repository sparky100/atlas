import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listDecisionBenefitChecks, recordDecisionBenefit } from '../../db/decisionBenefit';
import type { DecisionBenefitCheckRow, DecisionBenefitResult } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { BENEFIT_RESULTS, benefitLine, benefitResultLabel, benefitStepState, benefitTone } from './benefitCheck';
import styles from './DecisionView.module.css';

export interface DecisionBenefitProps {
  decisionId: UUID;
  /** The outcome the decision said it wanted, shown above the question. */
  outcome: string;
  chosenIsBaseline: boolean;
  /** The chosen option's change is merged into the live model. */
  inLiveModel: boolean;
  /** Owners and architects record the answer (the database checks too). */
  canRecord: boolean;
  /** The organisation's members, for "Who confirmed it?". */
  members: readonly { id: UUID; label: string }[];
  /** Who is asked by default: the decision's owner. */
  defaultConfirmer: UUID;
  nameOf: (id: UUID) => string;
}

/**
 * "Did we get the outcome?" (item 3, part 2). The last step on the path:
 * once the chosen option is in the live model, someone records whether the
 * benefit came, naming the member who confirmed it. Each answer is kept; the
 * newest is shown first.
 */
export function DecisionBenefit({ decisionId, outcome, chosenIsBaseline, inLiveModel, canRecord, members, defaultConfirmer, nameOf }: DecisionBenefitProps) {
  const step = benefitStepState({ chosenIsBaseline, inLiveModel });
  const [checks, setChecks] = useState<DecisionBenefitCheckRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<DecisionBenefitResult | null>(null);
  const [note, setNote] = useState('');
  const [confirmer, setConfirmer] = useState<UUID>(defaultConfirmer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setChecks(await listDecisionBenefitChecks(supabase, decisionId));
      setFailed(false);
    } catch (e) {
      setFailed(true);
      reportError('Could not load whether the outcome came.', e);
    }
  }, [decisionId]);

  useEffect(() => {
    if (step !== 'open') return;
    let live = true;
    void listDecisionBenefitChecks(supabase, decisionId)
      .then((rows) => {
        if (live) setChecks(rows);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setFailed(true);
        reportError('Could not load whether the outcome came.', e);
      });
    return () => {
      live = false;
    };
  }, [decisionId, step]);

  if (step === 'not_applicable') return null;

  const latest = checks?.[0];
  return (
    <Panel data-testid="decision-benefit">
      <Text as="h2" size="lg">
        Did we get the outcome?
      </Text>
      <Text as="p" tone={outcome.trim() !== '' ? 'default' : 'muted'}>
        {outcome.trim() !== '' ? `We wanted: ${outcome.trim()}` : 'No outcome was recorded for this decision, so say what the benefit was.'}
      </Text>
      {step === 'waiting_for_live' ? (
        <Text as="p" tone="muted" size="sm">
          Once the chosen option is in the live model, an owner or architect records here whether the outcome came.
        </Text>
      ) : (
        <>
          {failed && (
            <div role="alert">
              <Text as="p" size="sm">
                Could not load the answers.{' '}
                <Button variant="ghost" onClick={() => void load()}>
                  Try again
                </Button>
              </Text>
            </div>
          )}
          {checks !== null && latest === undefined && (
            <Text as="p" tone="muted">
              Not recorded yet.
            </Text>
          )}
          {latest !== undefined && (
            <div data-testid="decision-benefit-latest">
              <Chip tone={benefitTone(latest.result)}>{benefitResultLabel(latest.result)}</Chip>
              <Text as="p">{benefitLine(latest, nameOf(latest.confirmed_by))}</Text>
              <Text as="p" size="sm" tone="muted">
                Recorded by {nameOf(latest.recorded_by)}.
              </Text>
            </div>
          )}
          {checks !== null && checks.length > 1 && (
            <ul className={styles.linkList} aria-label="Earlier answers">
              {checks.slice(1).map((c) => (
                <li key={c.id}>
                  <Text as="span" size="sm" tone="muted">
                    {benefitLine(c, nameOf(c.confirmed_by))} Recorded by {nameOf(c.recorded_by)}.
                  </Text>
                </li>
              ))}
            </ul>
          )}
          {canRecord ? (
            checks !== null && (latest === undefined || latest.result === 'not_yet') ? (
              <form
                className={styles.editForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (result === null) {
                    setError('Choose Yes, Partly or Not yet.');
                    return;
                  }
                  setBusy(true);
                  setError(null);
                  void recordDecisionBenefit(supabase, { decisionId, result, note, confirmedBy: confirmer })
                    .then((row) => {
                      setChecks((prev) => [row, ...(prev ?? [])]);
                      setResult(null);
                      setNote('');
                    })
                    .catch((err: unknown) => {
                      setError(err instanceof Error ? err.message.replace(/^recordDecisionBenefit: (record_decision_benefit: )?/, '') : 'Could not record the answer.');
                    })
                    .finally(() => {
                      setBusy(false);
                    });
                }}
              >
                <fieldset>
                  <legend>
                    <Text as="span" size="sm">
                      {latest === undefined ? 'Did the outcome come?' : 'Has it come since?'}
                    </Text>
                  </legend>
                  {BENEFIT_RESULTS.map((r) => (
                    <label key={r.value}>
                      <input
                        type="radio"
                        name={`benefit-${decisionId}`}
                        value={r.value}
                        checked={result === r.value}
                        onChange={() => {
                          setResult(r.value);
                        }}
                      />{' '}
                      {r.label}
                    </label>
                  ))}
                </fieldset>
                <label>
                  <Text as="span" size="sm">
                    What happened (optional)
                  </Text>
                  <textarea
                    className={styles.textarea}
                    maxLength={1000}
                    placeholder="e.g. Quotes now take four days, not ten"
                    value={note}
                    onChange={(e) => {
                      setNote(e.target.value);
                    }}
                  />
                </label>
                <label>
                  <Text as="span" size="sm">
                    Who confirmed it?
                  </Text>
                  <select
                    value={confirmer}
                    onChange={(e) => {
                      setConfirmer(e.target.value);
                    }}
                  >
                    {!members.some((m) => m.id === confirmer) && <option value={confirmer}>A former member</option>}
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                {error !== null && (
                  <div role="alert">
                    <Text as="p" size="sm">
                      {error}
                    </Text>
                  </div>
                )}
                <Button type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Record the answer'}
                </Button>
              </form>
            ) : null
          ) : (
            latest === undefined && (
              <Text as="p" tone="muted" size="sm">
                An owner or architect records whether the outcome came.
              </Text>
            )
          )}
        </>
      )}
    </Panel>
  );
}
