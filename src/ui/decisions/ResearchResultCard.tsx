import type { ReactNode } from 'react';
import type { ButtonVariant } from '../components/Button/Button';
import { Button } from '../components/Button/Button';
import { Chip, type ChipTone } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import styles from './ResearchResultCard.module.css';

export interface ResearchEvidence {
  /** The claim or the provider's cited sentence. */
  text: string;
  /** The page the evidence came from, when it has one. */
  sourceUrl?: string;
  /** The source's own date, never the date it was read. */
  sourceDate?: string | null;
}

export interface ResearchCardAction {
  label: string;
  onClick?: () => void;
  /** An external page, opened in a new tab. */
  href?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  testId?: string;
}

export interface ResearchResultCardProps {
  testId?: string;
  kind: 'web' | 'catalogue';
  title: string;
  /** Vendor for a catalogue product, publisher/domain for a web page. */
  source: string;
  /** Why this result is here: the capability it supports, or the query it matched. */
  whyMatched?: string;
  evidence?: readonly ResearchEvidence[];
  status?: { label: string; tone: ChipTone };
  url?: string;
  /** A page or product the person can choose to carry into the option. */
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  actions?: readonly ResearchCardAction[];
  /** Extra content owned by the caller (for example the assertion box). */
  children?: ReactNode;
}

/**
 * One result from either the guarded web Researcher or the reviewed
 * catalogue, in one shape: what it is, where it came from, why it matched,
 * the evidence, its status and what the person can do next. Web pages are
 * always marked unreviewed; a reviewed catalogue claim is never presented as
 * if a person had checked the page themselves.
 */
export function ResearchResultCard({
  testId,
  kind,
  title,
  source,
  whyMatched,
  evidence = [],
  status,
  url,
  selectable = false,
  selected = false,
  onSelect,
  actions = [],
  children,
}: ResearchResultCardProps) {
  const classes = [styles.card, selected ? styles.selected : ''].filter(Boolean).join(' ');
  return (
    <article className={classes} data-testid={testId} aria-label={title}>
      <div className={styles.head}>
        {selectable && (
          <input
            type="radio"
            className={styles.radio}
            checked={selected}
            onChange={() => onSelect?.()}
            aria-label={`Choose ${title}`}
          />
        )}
        <div className={styles.titleBlock}>
          {url !== undefined ? (
            <a href={url} target="_blank" rel="noreferrer">
              <Text as="span" size="md">{title}</Text>
            </a>
          ) : (
            <Text as="span" size="md">{title}</Text>
          )}
          {source !== '' && (
            <Text as="span" size="xs" tone="muted">{source}</Text>
          )}
        </div>
        {status !== undefined && <Chip tone={status.tone}>{status.label}</Chip>}
      </div>

      {whyMatched !== undefined && whyMatched !== '' && (
        <Text as="p" size="sm" tone="muted">{whyMatched}</Text>
      )}

      {evidence.length > 0 && (
        <ul className={styles.evidence}>
          {evidence.map((item, index) => (
            <li key={`${item.text}\u0000${String(index)}`}>
              {item.sourceUrl !== undefined ? (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                  <Text as="span" size="sm">{item.text}</Text>
                </a>
              ) : (
                <Text as="span" size="sm">{item.text}</Text>
              )}
              {item.sourceDate !== null && item.sourceDate !== undefined && (
                <Text as="span" size="xs" tone="muted"> — source dated {item.sourceDate}</Text>
              )}
            </li>
          ))}
        </ul>
      )}

      {kind === 'web' && (
        <Text as="p" size="xs" tone="muted">
          Unreviewed web page. It is not a catalogue claim and no one has checked it.
        </Text>
      )}

      {actions.length > 0 && (
        <div className={styles.actions}>
          {actions.map((action) =>
            action.href !== undefined ? (
              <a key={action.label} className={styles.actionLink} href={action.href} target="_blank" rel="noreferrer">
                {action.label}
              </a>
            ) : (
              <Button
                key={action.label}
                variant={action.variant ?? 'secondary'}
                disabled={action.disabled}
                onClick={action.onClick}
                data-testid={action.testId}
              >
                {action.label}
              </Button>
            ),
          )}
        </div>
      )}

      {children}
    </article>
  );
}
