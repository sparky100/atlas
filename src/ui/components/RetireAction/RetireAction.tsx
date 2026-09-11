import { useId, useState } from 'react';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../../contracts/rows';
import type { UUID } from '../../../contracts/delta';
import type { BranchRow } from '../../../db/types';
import { attributesRecord } from '../../elements/attributesRecord';
import { useElementRetire, type RetireReplacement } from '../../elements/useElementRetire';
import { useRelationshipTargetSearch } from '../../elements/useRelationshipTargetSearch';
import { Button } from '../Button/Button';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import styles from './RetireAction.module.css';

export interface RetireActionProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  relationships: readonly RelationshipsHeadRow[];
  relationshipFacts: ReadonlyMap<UUID, Map<string, FactsRow>>;
  /** The "replaced by" picker's own search pool — always main's real head, same reasoning `ElementSearchAdd.tsx`/`RelationshipAdd.tsx` already give. */
  searchCommitId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onRetired: () => void;
  onCancel: () => void;
}

/**
 * Prompt 7k item 5's "Retire…" — planned end date (required: that's the
 * whole point of retiring something), plus an optional "replaced by"
 * search picker (system-only, excluding this element itself) whose
 * capability transfer is `useElementRetire`'s own job. See that hook's
 * doc comment for what the transfer does and doesn't attempt.
 */
export function RetireAction({
  modelId,
  orgId,
  userId,
  element,
  facts,
  relationships,
  relationshipFacts,
  searchCommitId,
  branch,
  expectedHeadCommitId,
  onRetired,
  onCancel,
}: RetireActionProps) {
  const currentPlannedEnd = attributesRecord(element.attributes).plannedEnd;
  const [plannedEnd, setPlannedEnd] = useState(typeof currentPlannedEnd === 'string' ? currentPlannedEnd : '');
  const [replacement, setReplacement] = useState<RetireReplacement | null>(null);
  const [pickingReplacement, setPickingReplacement] = useState(false);
  const plannedEndId = useId();
  const search = useRelationshipTargetSearch(searchCommitId, modelId, ['system'], element.element_id, pickingReplacement);
  const { status, error, retire } = useElementRetire({
    modelId,
    orgId,
    userId,
    element,
    facts,
    relationships,
    relationshipFacts,
    branch,
    expectedHeadCommitId,
    onRetired,
  });

  return (
    <div className={styles.panel}>
      <Text as="p" size="sm">
        Retire &ldquo;{element.name}&rdquo;? This sets its lifecycle to retiring and records a planned end date.
      </Text>
      <label htmlFor={plannedEndId}>
        <Text as="span" size="sm" tone="muted">
          Planned end
        </Text>
      </label>
      <input
        id={plannedEndId}
        type="date"
        className={styles.input}
        value={plannedEnd}
        onChange={(e) => {
          setPlannedEnd(e.target.value);
        }}
      />

      {replacement ? (
        <Text as="p" size="sm">
          Replaced by <strong>{replacement.name}</strong> — the capabilities it supports transfer to the replacement.{' '}
          <Button
            variant="ghost"
            onClick={() => {
              setReplacement(null);
            }}
            disabled={status === 'retiring'}
          >
            Change
          </Button>
        </Text>
      ) : pickingReplacement ? (
        <div>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- opening this picker is itself the request to type a search.
            autoFocus
            type="text"
            className={styles.input}
            placeholder="Search systems…"
            value={search.query}
            onChange={(e) => {
              search.setQuery(e.target.value);
            }}
          />
          {search.status === 'loading' && (
            <Text as="p" tone="muted" size="sm">
              Loading…
            </Text>
          )}
          {search.results.length > 0 && (
            <ul className={styles.results}>
              {search.results.map((result) => (
                <li key={result.element_id}>
                  <button
                    type="button"
                    className={styles.resultRow}
                    onClick={() => {
                      setReplacement({ elementId: result.element_id, name: result.name });
                      setPickingReplacement(false);
                    }}
                  >
                    <ElementTypeGlyph type={result.element_type} />
                    <Text as="span">{result.name}</Text>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setPickingReplacement(false);
            }}
          >
            Cancel search
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          onClick={() => {
            setPickingReplacement(true);
          }}
        >
          + Replaced by…
        </Button>
      )}

      <div className={styles.actions}>
        <Button variant="primary" onClick={() => void retire(plannedEnd, replacement)} disabled={status === 'retiring' || plannedEnd.trim() === ''}>
          {status === 'retiring' ? 'Retiring…' : 'Retire'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={status === 'retiring'}>
          Cancel
        </Button>
      </div>
      {error !== null && (
        <Text as="p" tone="default">
          {error}
        </Text>
      )}
    </div>
  );
}
