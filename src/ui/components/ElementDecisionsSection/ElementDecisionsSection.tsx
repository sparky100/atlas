import { Link } from 'react-router';
import type { UUID } from '../../../contracts/delta';
import type { BranchRow } from '../../../db/types';
import { intentHeaderLine } from '../../changes/branchIntent';
import { branchStatusTone } from '../../changes/branchStatus';
import type { ElementPageDecisionEntry } from '../../elements/useElementPage';
import { decisionStatusLabel, decisionStatusTone } from '../../decisions/decisionStatus';
import { Chip } from '../Chip/Chip';
import { Text } from '../Text/Text';
import styles from './ElementDecisionsSection.module.css';

export interface ElementDecisionsSectionProps {
  entries: readonly ElementPageDecisionEntry[];
  orgSlug: string;
  modelSlug: string;
}

/**
 * "Why is this here" (prompt pack F3 PR6) — `ElementPage.tsx`'s
 * "Decisions" section, filled in for real: every decision that names this
 * element (or, for a capability, one of its own capability ancestors) as
 * something it concerns, plus each decision's own options — the chosen one
 * and every "losing" (cancelled) one alike for a decision that's already
 * `accepted`, still-`draft` options for one that isn't. Replaces the
 * hardcoded `<EmptyState>No decisions recorded</EmptyState>` this section
 * used to render unconditionally (Prompt 7h bug B6's own placeholder,
 * predating the schema this PR now reads).
 */
export function ElementDecisionsSection({ entries, orgSlug, modelSlug }: ElementDecisionsSectionProps) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <ul className={styles.list}>
      {entries.map((entry) => (
        <DecisionEntryRow key={entry.decision.id} entry={entry} orgSlug={orgSlug} modelSlug={modelSlug} />
      ))}
    </ul>
  );
}

function DecisionEntryRow({ entry, orgSlug, modelSlug }: { entry: ElementPageDecisionEntry; orgSlug: string; modelSlug: string }) {
  const { decision, options } = entry;
  const chosen = options.find((b) => b.id === decision.branch_id);
  const others = options.filter((b) => b.id !== decision.branch_id);
  return (
    <li className={styles.row}>
      <div className={styles.rowHeader}>
        <Link to={decisionHref(orgSlug, modelSlug, decision.id)}>
          <Text as="span" size="md">
            {decision.title}
          </Text>
        </Link>
        <Chip tone={decisionStatusTone(decision.status)}>{decisionStatusLabel(decision.status)}</Chip>
      </div>
      {chosen && (
        <Text as="p" tone="muted" size="sm">
          Chosen: {optionLabel(chosen, orgSlug, modelSlug)}
        </Text>
      )}
      {others.length > 0 && (
        <Text as="p" tone="faint" size="sm">
          {chosen ? 'Also considered: ' : 'Options: '}
          {others.map((b, i) => (
            <span key={b.id}>
              {i > 0 && ', '}
              {optionLabel(b, orgSlug, modelSlug)}
            </span>
          ))}
        </Text>
      )}
    </li>
  );
}

function decisionHref(orgSlug: string, modelSlug: string, decisionId: UUID): string {
  return `/o/${orgSlug}/m/${modelSlug}/decisions/${decisionId}`;
}

function optionLabel(branch: BranchRow, orgSlug: string, modelSlug: string) {
  return (
    <Link to={`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`}>
      <Text as="span" size="sm">
        {intentHeaderLine(branch)}
      </Text>
      <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
    </Link>
  );
}
