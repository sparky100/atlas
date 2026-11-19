import { useState } from 'react';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import styles from './DecisionBaselineCard.module.css';

export interface DecisionBaselineCardProps {
  stayRisk: string;
  stayReason: string;
  /** Owner/architect/contributor on a proposed decision. */
  canEdit: boolean;
  /** `true` when this option can be chosen right now (proposed, owner/architect, option still a draft). */
  canChoose: boolean;
  isChosen: boolean;
  busy: boolean;
  onSave: (stayRisk: string, stayReason: string) => void;
  onChoose: () => void;
}

/**
 * The "Stay as we are" baseline: the option every other option is compared
 * against. It is described, not scored, so it has two plain-text answers and
 * no criteria ratings.
 */
export function DecisionBaselineCard({ stayRisk, stayReason, canEdit, canChoose, isChosen, busy, onSave, onChoose }: DecisionBaselineCardProps) {
  const [risk, setRisk] = useState(stayRisk);
  const [reason, setReason] = useState(stayReason);
  const dirty = risk.trim() !== stayRisk || reason.trim() !== stayReason;
  return (
    <section className={styles.card} aria-label="Stay as we are">
      <Text as="h3" size="md">
        Stay as we are {isChosen ? '(chosen)' : '(baseline)'}
      </Text>
      <Text as="p" tone="muted" size="sm">
        The other options are compared against this. Describe it; it is not scored.
      </Text>
      <label className={styles.label}>
        <Text as="span" size="sm" tone="muted">
          What is the operational risk of staying as we are?
        </Text>
        {canEdit ? (
          <textarea
            className={styles.textarea}
            value={risk}
            onChange={(e) => {
              setRisk(e.target.value);
            }}
          />
        ) : (
          <Text as="p">{stayRisk.length > 0 ? stayRisk : 'Not written down.'}</Text>
        )}
      </label>
      <label className={styles.label}>
        <Text as="span" size="sm" tone="muted">
          Why can't or won't we change?
        </Text>
        {canEdit ? (
          <textarea
            className={styles.textarea}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        ) : (
          <Text as="p">{stayReason.length > 0 ? stayReason : 'Not written down.'}</Text>
        )}
      </label>
      <div className={styles.actions}>
        {canEdit && (
          <Button
            variant="secondary"
            disabled={busy || !dirty}
            onClick={() => {
              onSave(risk, reason);
            }}
          >
            Save baseline
          </Button>
        )}
        {canChoose && (
          <Button variant="secondary" disabled={busy} onClick={onChoose}>
            Go with staying as we are
          </Button>
        )}
      </div>
    </section>
  );
}
