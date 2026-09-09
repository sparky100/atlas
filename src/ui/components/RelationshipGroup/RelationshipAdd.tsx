import { useRef, useState } from 'react';
import type { ElementsHeadRow } from '../../../contracts/rows';
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
  /** The other endpoint's element id, once creation succeeds — lets the caller mark the new row "just added" (Handoff — Flow: Add a system, step 7) without a second round trip. */
  onCreated: (otherElementId: UUID) => void;
}

const DIRECTION_VERB: Record<RelationshipType, { outbound: string; inbound: string }> = {
  supports: { outbound: 'supports', inbound: 'supported by' },
  owns: { outbound: 'owns', inbound: 'owned by' },
  uses: { outbound: 'uses', inbound: 'used by' },
  flows_to: { outbound: 'flows to', inbound: 'receives from' },
};

/** Handoff — Flow: Add a system, step 6: `uses`/`flows_to` alone get a second, verb-phrase stage — their own contract attributes carry a free-text `description` (`UsesAttributes`/`FlowsToAttributes`), the phrase this control writes there. `supports`/`owns` have no such field worth asking for at add time, so picking a result creates immediately, as before. */
const VERB_PHRASE_TYPES: readonly RelationshipType[] = ['uses', 'flows_to'];

/**
 * One relationship-type group's "+ Add" (Blocking: element creation, per
 * the user's own clarification on where this lives): search-first, no
 * create-new fallback (`useRelationshipTargetSearch`'s own module comment)
 * — pick an existing element of a legal target type, and this element
 * gains a `relationshipType` relationship to it in the given `direction`.
 * For `uses`/`flows_to`, picking a target moves to a second stage — both
 * shown in the same overlay so the sequence stays legible — asking for the
 * verb phrase that becomes the relationship's own `description`.
 */
export function RelationshipAdd({ slot, direction, elementId, modelId, orgId, userId, searchCommitId, branch, expectedHeadCommitId, onCreated }: RelationshipAddProps) {
  const [open, setOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<ElementsHeadRow | null>(null);
  const [verbPhrase, setVerbPhrase] = useState('');
  const search = useRelationshipTargetSearch(searchCommitId, modelId, slot.targetTypes, elementId);
  const needsVerbPhrase = VERB_PHRASE_TYPES.includes(slot.relationshipType);
  // Set right before each `create()` call so the hook's own success callback
  // (which carries no arguments of its own) can still report which element
  // the new relationship points at.
  const targetIdRef = useRef<UUID | null>(null);
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
      setPendingTarget(null);
      setVerbPhrase('');
      if (targetIdRef.current) onCreated(targetIdRef.current);
    },
  });

  const close = () => {
    setOpen(false);
    setPendingTarget(null);
    setVerbPhrase('');
  };

  const confirmTarget = (result: ElementsHeadRow) => {
    if (needsVerbPhrase) {
      setPendingTarget(result);
      return;
    }
    targetIdRef.current = result.element_id;
    void create(result.element_id);
  };

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => { setOpen(true); }}>
        + Add {DIRECTION_VERB[slot.relationshipType][direction]}
      </Button>
    );
  }

  if (pendingTarget) {
    return (
      <div className={styles.panel}>
        <Text as="p" size="sm" tone="muted">
          {DIRECTION_VERB[slot.relationshipType][direction]} {pendingTarget.name}
        </Text>
        <Text as="label" size="sm">
          Verb phrase
        </Text>
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- reaching this stage is the request to type a phrase.
          autoFocus
          type="text"
          className={styles.input}
          placeholder="e.g. reads customer records from"
          value={verbPhrase}
          onChange={(e) => { setVerbPhrase(e.target.value); }}
        />
        <Text as="p" tone="faint" size="xs">
          Stored as this relationship&rsquo;s own description — optional; leave blank to add it plainly, without a phrase.
        </Text>
        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={status === 'creating'}
            onClick={() => {
              targetIdRef.current = pendingTarget.element_id;
              void create(pendingTarget.element_id, verbPhrase.trim().length > 0 ? { description: verbPhrase.trim() } : undefined);
            }}
          >
            {status === 'creating' ? 'Adding…' : 'Add'}
          </Button>
          <Button variant="ghost" onClick={() => { setPendingTarget(null); }} disabled={status === 'creating'}>
            Back
          </Button>
          <Button variant="ghost" onClick={close} disabled={status === 'creating'}>
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
              <button type="button" className={styles.resultRow} disabled={status === 'creating'} onClick={() => { confirmTarget(result); }}>
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
        <Button variant="ghost" onClick={close} disabled={status === 'creating'}>
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
