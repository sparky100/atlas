import { useState } from 'react';
import type { RelationshipType, UUID } from '../../../contracts/delta';
import type { RelationshipGroupSlot } from '../../../contracts/relationshipTypeRules';
import type { BranchRow } from '../../../db/types';
import { useRelationshipCreate } from '../../elements/useRelationshipCreate';
import { useRelationshipTargetSearch } from '../../elements/useRelationshipTargetSearch';
import { Button } from '../Button/Button';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import styles from './RelationshipAdd.module.css';

export interface RelationshipAddProps {
  slot: RelationshipGroupSlot;
  direction: 'outbound' | 'inbound';
  elementId: UUID;
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  searchCommitId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onCreated: () => void;
}

const DIRECTION_VERB: Record<RelationshipType, { outbound: string; inbound: string }> = {
  supports: { outbound: 'supports', inbound: 'supported by' },
  owns: { outbound: 'owns', inbound: 'owned by' },
  uses: { outbound: 'uses', inbound: 'used by' },
  flows_to: { outbound: 'flows to', inbound: 'receives from' },
};

/**
 * One relationship-type group's "+ Add" (Blocking: element creation, per
 * the user's own clarification on where this lives): search-first, no
 * create-new fallback (`useRelationshipTargetSearch`'s own module comment)
 * — pick an existing element of a legal target type, and this element
 * gains a `relationshipType` relationship to it in the given `direction`.
 */
export function RelationshipAdd({ slot, direction, elementId, modelId, orgId, userId, searchCommitId, branch, expectedHeadCommitId, onCreated }: RelationshipAddProps) {
  const [open, setOpen] = useState(false);
  const search = useRelationshipTargetSearch(searchCommitId, modelId, slot.targetTypes, elementId);
  const { status, error, create } = useRelationshipCreate({
    modelId,
    orgId,
    userId,
    relationshipType: slot.relationshipType,
    direction,
    elementId,
    branch,
    expectedHeadCommitId,
    onCreated: () => {
      setOpen(false);
      onCreated();
    },
  });

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => { setOpen(true); }}>
        + Add {DIRECTION_VERB[slot.relationshipType][direction]}
      </Button>
    );
  }

  return (
    <div className={styles.panel}>
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opening this control is the request to type a search.
        autoFocus
        type="text"
        className={styles.input}
        placeholder="Search…"
        value={search.query}
        onChange={(e) => { search.setQuery(e.target.value); }}
      />
      {search.status === 'loading' && (
        <Text as="p" tone="muted" size="sm">
          Loading…
        </Text>
      )}
      {search.status === 'error' && (
        <Text as="p" size="sm">
          {search.error}
        </Text>
      )}
      {search.status === 'ready' && search.query.trim().length > 0 && search.results.length === 0 && (
        <Text as="p" tone="muted" size="sm">
          Nothing matches.
        </Text>
      )}
      {search.results.length > 0 && (
        <ul className={styles.results}>
          {search.results.map((result) => (
            <li key={result.element_id}>
              <button type="button" className={styles.resultRow} disabled={status === 'creating'} onClick={() => void create(result.element_id)}>
                <ElementTypeGlyph type={result.element_type} />
                <Text as="span">{result.name}</Text>
                <Text as="span" tone="muted" size="sm">
                  {result.element_type}
                </Text>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <Button variant="ghost" onClick={() => { setOpen(false); }} disabled={status === 'creating'}>
          Cancel
        </Button>
      </div>
      {error !== null && (
        <Text as="p" size="sm">
          {error}
        </Text>
      )}
    </div>
  );
}
