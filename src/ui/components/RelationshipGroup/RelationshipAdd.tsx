import { useState } from 'react';
import type { RelationshipType, UUID } from '../../../contracts/delta';
import type { FactsRow, RelationshipsHeadRow } from '../../../contracts/rows';
import type { RelationshipGroupSlot } from '../../../contracts/relationshipTypeRules';
import type { BranchRow } from '../../../db/types';
import { attributesRecord } from '../../elements/attributesRecord';
import { useRelationshipCreate, type RelationshipCreateDemotion } from '../../elements/useRelationshipCreate';
import { useRelationshipTargetSearch } from '../../elements/useRelationshipTargetSearch';
import { Button } from '../Button/Button';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import { defaultAttributesForPlainPick } from './relationshipAddDefaults';
import styles from './RelationshipAdd.module.css';

export interface RelationshipAddProps {
  slot: RelationshipGroupSlot;
  direction: 'outbound' | 'inbound';
  elementId: UUID;
  /** Same element's name — only for the generated commit title (`useRelationshipCreate`'s own doc comment). */
  elementName: string;
  /** This exact type+direction's own existing rows (`RelationshipsSection.tsx`'s already-computed `outboundRows`/`inboundRows`) — only read for `supports`/outbound, B4's "asks 'primary?' only when the system already has a supports link". */
  existingRows: readonly RelationshipsHeadRow[];
  /** Needed alongside `existingRows` for the same B4 flow: demoting the system's current primary supports edge (if the new one is answered "yes, primary") is a `relationship.update` on that *other* relationship, and C6 needs the delta currently asserting its `role` as `previousDeltaId`. */
  relationshipFacts: ReadonlyMap<UUID, Map<string, FactsRow>>;
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

interface PendingTarget {
  elementId: UUID;
  name: string;
}

/**
 * One relationship-type group's "+ Add" (Blocking: element creation, per
 * the user's own clarification on where this lives): search-first, no
 * create-new fallback (`useRelationshipTargetSearch`'s own module comment)
 * — pick an existing element of a legal target type, and this element
 * gains a `relationshipType` relationship to it in the given `direction`.
 *
 * Sprint U4-1 B4 adds one more step for `supports`/outbound only (a
 * system's own "what does this support" side, the landscape lane a
 * system's tile is placed in): once the system already has at least one
 * supports link, picking a target doesn't create the relationship
 * immediately — it asks "primary?" first. Answering "yes" demotes
 * whichever edge currently holds `role: 'primary'` (if any) to
 * `'secondary'` in the *same* commit — the database's own partial unique
 * index (`relationships_head_one_primary_supports_per_system`) would
 * reject the commit otherwise. The very first supports link a system gets
 * is never asked — nothing to compare it against yet — and is created
 * `role: 'secondary'` outright; `computeLandscapeLayout`'s own "no primary
 * -> most recently added decides" fallback is exactly what then places it,
 * correctly, without ever needing to ask.
 *
 * Sprint U4-1 B5 adds a second, unconditional step for `uses`/`flows_to`:
 * both require a verb-phrase label (what this edge actually does — "reads
 * customer records from", not just "uses") before the relationship is
 * created at all, stored in the attribute both types already had
 * (`UsesAttributes`/`FlowsToAttributes.description`, previously optional
 * free text nobody was ever asked for). This is a create-time UI
 * requirement, not a contract or engine change — an existing relationship
 * with no label stays perfectly valid to read; the health findings panel's
 * new "missing a label" finding (`findUnlabeledVerbRelationships`,
 * src/db/healthFindings.ts) is what catches one that predates this or
 * slips through some other path, exactly the "review checklist flags any
 * without one" the sprint item asked for.
 */
export function RelationshipAdd({ slot, direction, elementId, elementName, existingRows, relationshipFacts, modelId, orgId, userId, searchCommitId, branch, expectedHeadCommitId, onCreated }: RelationshipAddProps) {
  const [open, setOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<PendingTarget | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const search = useRelationshipTargetSearch(searchCommitId, modelId, slot.targetTypes, elementId);
  const { status, error, create } = useRelationshipCreate({
    modelId,
    orgId,
    userId,
    relationshipType: slot.relationshipType,
    direction,
    elementId,
    elementName,
    branch,
    expectedHeadCommitId,
    onCreated: () => {
      setOpen(false);
      setPendingTarget(null);
      setLabelDraft('');
      onCreated();
    },
  });

  const asksPrimary = slot.relationshipType === 'supports' && direction === 'outbound' && existingRows.length > 0;
  const needsLabel = slot.relationshipType === 'uses' || slot.relationshipType === 'flows_to';

  function currentPrimaryDemotion(): RelationshipCreateDemotion | null {
    const currentPrimary = existingRows.find((row) => attributesRecord(row.attributes).role === 'primary');
    if (!currentPrimary) return null;
    const previousDeltaId = relationshipFacts.get(currentPrimary.relationship_id)?.get('role')?.delta_id ?? currentPrimary.exists_delta_id;
    return { relationshipId: currentPrimary.relationship_id, previousDeltaId, attribute: 'role', value: 'secondary' };
  }

  function pickResult(target: PendingTarget): void {
    if (asksPrimary || needsLabel) {
      setPendingTarget(target);
      return;
    }
    void create(target.elementId, target.name, defaultAttributesForPlainPick(slot.relationshipType));
  }

  function answerPrimary(primary: boolean): void {
    if (!pendingTarget) return;
    void create(pendingTarget.elementId, pendingTarget.name, { role: primary ? 'primary' : 'secondary' }, primary ? currentPrimaryDemotion() : null);
  }

  function submitLabel(): void {
    const label = labelDraft.trim();
    if (!pendingTarget || label.length === 0) return;
    void create(pendingTarget.elementId, pendingTarget.name, { description: label });
  }

  function cancelPending(): void {
    setPendingTarget(null);
    setLabelDraft('');
  }

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => { setOpen(true); }}>
        + Add {DIRECTION_VERB[slot.relationshipType][direction]}
      </Button>
    );
  }

  if (pendingTarget && asksPrimary) {
    return (
      <div className={styles.panel}>
        <Text as="p" size="sm">
          Make {pendingTarget.name} the primary capability for this system?
        </Text>
        <Text as="p" tone="muted" size="sm">
          The primary capability decides which landscape lane this system's tile appears in.
        </Text>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => { answerPrimary(true); }} disabled={status === 'creating'}>
            {status === 'creating' ? 'Adding…' : 'Yes, primary'}
          </Button>
          <Button variant="ghost" onClick={() => { answerPrimary(false); }} disabled={status === 'creating'}>
            No
          </Button>
          <Button variant="ghost" onClick={cancelPending} disabled={status === 'creating'}>
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

  if (pendingTarget && needsLabel) {
    return (
      <div className={styles.panel}>
        <Text as="p" size="sm">
          What does this {slot.relationshipType === 'uses' ? 'use' : 'flow'} do? ({DIRECTION_VERB[slot.relationshipType][direction]} {pendingTarget.name})
        </Text>
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- picking a target is the request to type its label next.
          autoFocus
          type="text"
          className={styles.input}
          placeholder="e.g. reads customer records from"
          value={labelDraft}
          onChange={(e) => { setLabelDraft(e.target.value); }}
        />
        <div className={styles.actions}>
          <Button variant="secondary" onClick={submitLabel} disabled={status === 'creating' || labelDraft.trim().length === 0}>
            {status === 'creating' ? 'Adding…' : 'Add'}
          </Button>
          <Button variant="ghost" onClick={cancelPending} disabled={status === 'creating'}>
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
              <button type="button" className={styles.resultRow} disabled={status === 'creating'} onClick={() => { pickResult({ elementId: result.element_id, name: result.name }); }}>
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
