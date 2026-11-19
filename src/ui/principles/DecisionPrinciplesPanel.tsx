import { useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { PRINCIPLE_LIMITS, principleStanceLabel, type DecisionPrincipleRow, type PrincipleRow, type PrincipleStance } from '../../contracts/principles';
import { Button } from '../components/Button/Button';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Chip } from '../components/Chip/Chip';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { decisionPrincipleLines } from './decisionPrinciples';
import styles from './PrinciplesView.module.css';

export interface DecisionPrinciplesPanelProps {
  principles: readonly PrincipleRow[];
  links: readonly DecisionPrincipleRow[];
  /** While the decision is proposed and the person may link: radios and a reason box are shown. Otherwise the panel only reads. */
  editable: boolean;
  /** The principles whose stance is saving now; only their own cards lock. */
  savingIds: ReadonlySet<string>;
  error: string | null;
  principlesHref: string;
  onSetStance: (principleId: UUID, stance: PrincipleStance | null, reason: string) => Promise<boolean>;
}

/**
 * ADR-034 PR 3: the model's principles on the decision, beside the options. For each, the decision follows it,
 * departs from it (a reason is required), or takes no view. Plain words, no score. Once the decision is decided
 * it lists only the principles it cites, as a record.
 */
export function DecisionPrinciplesPanel({ principles, links, editable, savingIds, error, principlesHref, onSetStance }: DecisionPrinciplesPanelProps) {
  const lines = decisionPrincipleLines(principles, links, editable);
  // A reason being typed for a departure that isn't saved yet.
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [departing, setDeparting] = useState<ReadonlySet<string>>(new Set());

  if (lines.length === 0 && !editable) return null;

  const setDraft = (id: string, value: string) => {
    setDrafts({ ...drafts, [id]: value });
  };
  const startDeparting = (id: string, reason: string) => {
    setDrafts({ ...drafts, [id]: drafts[id] ?? reason });
    setDeparting(new Set(departing).add(id));
  };
  const stopDeparting = (id: string) => {
    const next = new Set(departing);
    next.delete(id);
    setDeparting(next);
  };

  return (
    <Panel>
      <CollapsibleSection title="Principles" meta={`(${String(lines.filter((l) => l.stance !== null).length)} of ${String(lines.length)} with a stance)`}>
      {lines.length === 0 ? (
        <Text as="p" tone="muted">
          This model has no principles yet. <Link to={principlesHref}>Add some on the Principles page.</Link>
        </Text>
      ) : (
        <>
          {editable && (
            <Text as="p" tone="muted" size="sm">
              Say which principles this decision follows and which it departs from. A departure needs a reason. Taking no view is fine.
            </Text>
          )}
          <ul className={styles.list}>
            {lines.map(({ principle, stance, reason }) => {
              const isDeparting = departing.has(principle.id);
              const name = `stance-${principle.id}`;
              const saving = savingIds.has(principle.id);
              return (
                <li key={principle.id} className={styles.card}>
                  <div className={styles.cardHead}>
                    <Text as="h3" size="lg" className={styles.title}>
                      {principle.title}
                    </Text>
                    {principle.status === 'retired' && <Chip tone="neutral">Retired</Chip>}
                    {!editable && stance !== null && <Chip tone={stance === 'departs' ? 'warn' : 'neutral'}>{principleStanceLabel(stance)}</Chip>}
                  </div>
                  <Text as="p">{principle.statement}</Text>
                  {!editable && stance === 'departs' && (
                    <Text as="p" size="sm" tone="muted">
                      Reason: {reason}
                    </Text>
                  )}
                  {editable && (
                    <fieldset className={styles.stanceGroup} disabled={saving}>
                      <legend>
                        <Text as="span" size="sm" tone="muted">
                          This decision…
                        </Text>
                      </legend>
                      <label className={styles.pick}>
                        <input
                          type="radio"
                          name={name}
                          checked={stance === null && !isDeparting}
                          onChange={() => {
                            stopDeparting(principle.id);
                            void onSetStance(principle.id, null, '');
                          }}
                        />
                        <Text as="span">Takes no view</Text>
                      </label>
                      <label className={styles.pick}>
                        <input
                          type="radio"
                          name={name}
                          aria-label={`Follows ${principle.title}`}
                          checked={stance === 'follows' && !isDeparting}
                          onChange={() => {
                            stopDeparting(principle.id);
                            void onSetStance(principle.id, 'follows', '');
                          }}
                        />
                        <Text as="span">Follows it</Text>
                      </label>
                      <label className={styles.pick}>
                        <input
                          type="radio"
                          name={name}
                          aria-label={`Departs from ${principle.title}`}
                          checked={stance === 'departs' || isDeparting}
                          onChange={() => {
                            startDeparting(principle.id, reason);
                          }}
                        />
                        <Text as="span">Departs from it</Text>
                      </label>
                      {(isDeparting || stance === 'departs') && (
                        <div className={styles.form}>
                          <label htmlFor={`reason-${principle.id}`} className={styles.fieldLabel}>
                            <Text as="span" size="sm" tone="muted">
                              Why depart from it? (required)
                            </Text>
                          </label>
                          <textarea
                            id={`reason-${principle.id}`}
                            className={styles.textarea}
                            maxLength={PRINCIPLE_LIMITS.reason}
                            value={drafts[principle.id] ?? reason}
                            onChange={(e) => {
                              setDraft(principle.id, e.target.value);
                            }}
                          />
                          <div className={styles.actions}>
                            <Button
                              variant="secondary"
                              type="button"
                              disabled={saving}
                              onClick={() => {
                                void onSetStance(principle.id, 'departs', drafts[principle.id] ?? reason).then((ok) => {
                                  if (ok) stopDeparting(principle.id);
                                });
                              }}
                            >
                              Save departure
                            </Button>
                          </div>
                        </div>
                      )}
                    </fieldset>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {error !== null && <Text as="p">{error}</Text>}
      </CollapsibleSection>
    </Panel>
  );
}
