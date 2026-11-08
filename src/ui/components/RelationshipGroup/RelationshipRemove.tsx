import { useId, useState } from 'react';
import type { UUID } from '../../../contracts/delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../../contracts/rows';
import type { BranchRow } from '../../../db/types';
import { useRelationshipRemove, type RelationshipPromotion } from '../../elements/useRelationshipRemove';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import { isPrimaryOutboundSupportsRow, otherPrimaryCandidates, relationshipRemovalEffectSentence } from './relationshipRemovalEffect';
import styles from './RelationshipRemove.module.css';

/** Everything `RelationshipRemove` needs beyond the row itself — mirrors `RelationshipsSectionAddConfig`'s own shape/rationale (one object so the caller's prop list doesn't grow one entry per field). */
export interface RelationshipsSectionRemoveConfig {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onRemoved: () => void;
}

export interface RelationshipRemoveProps {
  relationship: RelationshipsHeadRow;
  direction: 'outbound' | 'inbound';
  /** This element's own name (the hub whose page this row lives on) — the effect sentence's subject. */
  elementName: string;
  /** The other endpoint's resolved name — `undefined` when it can't be resolved (e.g. retracted since); Remove still works, with a generic "(unknown element)" in its place, the same "never block on unresolved data" stance `RelationshipsSection.tsx`'s own row rendering already takes. */
  otherName: string | undefined;
  /** This exact type+direction group's own full row list (`RelationshipsSection.tsx`'s already-computed `outboundRows`) — only read for the outbound-supports "make `<other>` primary" candidates. */
  siblingRows: readonly RelationshipsHeadRow[];
  /** Resolves a candidate row's own capability (`to_element_id`) to its name, for the promotion buttons. */
  endpoints: ReadonlyMap<UUID, ElementsHeadRow>;
  relationshipFacts: ReadonlyMap<UUID, Map<string, FactsRow>>;
  config: RelationshipsSectionRemoveConfig;
}

const UNKNOWN_NAME = '(unknown element)';

/**
 * "Relationship removal": the per-row "⋯" → "Remove" control
 * (`RelationshipsSection.tsx`'s own doc comment explains why this is a
 * one-item menu rather than a bare button) and its confirmation panel.
 * Omitted entirely by the caller when the caller hasn't established edit
 * rights — this component has no permission check of its own, same
 * convention as `RelationshipAdd.tsx`.
 *
 * Scoped exactly like `RelationshipAdd.tsx`'s own `asksPrimary`: the
 * "make `<other>` primary" affordance below only ever appears for an
 * outbound `supports` row currently holding `role: 'primary'`
 * (`isPrimaryOutboundSupportsRow`) — never on the inbound ("supported by")
 * side, where there's no single natural "other" candidate (see
 * `relationshipRemovalEffect.ts`'s own comment). Every other case — `owns`,
 * `uses`/`flows_to`, a secondary `supports` row, or either type's inbound
 * side — is plain: one effect sentence, one "Remove" button.
 */
export function RelationshipRemove({ relationship, direction, elementName, otherName, siblingRows, endpoints, relationshipFacts, config }: RelationshipRemoveProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuId = useId();
  const resolvedOtherName = otherName ?? UNKNOWN_NAME;

  const isPrimarySupports = isPrimaryOutboundSupportsRow(relationship.relationship_type, direction, relationship);
  const otherCandidates = isPrimarySupports ? otherPrimaryCandidates(relationship.relationship_id, siblingRows) : [];

  const existsDeltaId = relationshipFacts.get(relationship.relationship_id)?.get('$exists')?.delta_id ?? relationship.exists_delta_id;

  const { status, error, remove } = useRelationshipRemove({
    modelId: config.modelId,
    orgId: config.orgId,
    userId: config.userId,
    relationship,
    existsDeltaId,
    fromElementName: direction === 'outbound' ? elementName : resolvedOtherName,
    toElementName: direction === 'outbound' ? resolvedOtherName : elementName,
    branch: config.branch,
    expectedHeadCommitId: config.expectedHeadCommitId,
    onRemoved: () => {
      setOpen(false);
      setConfirming(false);
      config.onRemoved();
    },
  });

  function close(): void {
    setOpen(false);
    setConfirming(false);
  }

  function removeWithPromotion(candidate: RelationshipsHeadRow): void {
    const previousDeltaId = relationshipFacts.get(candidate.relationship_id)?.get('role')?.delta_id ?? candidate.exists_delta_id;
    const promotion: RelationshipPromotion = { relationshipId: candidate.relationship_id, previousDeltaId };
    void remove(promotion);
  }

  return (
    <div className={styles.menuWrapper}>
      <button
        type="button"
        className={styles.menuToggle}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Relationship actions"
        onClick={() => { if (open) close(); else setOpen(true); }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && !confirming && (
        <div id={menuId} className={styles.menu}>
          <button type="button" className={[styles.menuItem, styles.menuItemDanger].join(' ')} onClick={() => { setConfirming(true); }}>
            <Text as="span">Remove</Text>
          </button>
        </div>
      )}
      {open && confirming && (
        <div id={menuId} className={styles.panel}>
          <Text as="p" size="sm">
            {relationshipRemovalEffectSentence(relationship.relationship_type, direction, elementName, resolvedOtherName)}
          </Text>
          {isPrimarySupports && otherCandidates.length === 0 && (
            <Text as="p" tone="muted" size="sm">
              This was {elementName}&rsquo;s only supports edge — it will move to the Unassigned lane.
            </Text>
          )}
          {isPrimarySupports && otherCandidates.length > 0 && (
            <>
              <Text as="p" tone="muted" size="sm">
                {elementName} will have no main capability unless you choose one below.
              </Text>
              <div className={styles.actions}>
                {otherCandidates.map((candidate) => {
                  const capability = endpoints.get(candidate.to_element_id);
                  return (
                    <Button key={candidate.relationship_id} variant="destructive" onClick={() => { removeWithPromotion(candidate); }} disabled={status === 'removing'}>
                      {status === 'removing' ? 'Removing…' : `Remove and make ${capability?.name ?? UNKNOWN_NAME} the main capability`}
                    </Button>
                  );
                })}
              </div>
            </>
          )}
          <div className={styles.actions}>
            <Button variant="destructive" onClick={() => { void remove(); }} disabled={status === 'removing'}>
              {status === 'removing' ? 'Removing…' : 'Remove'}
            </Button>
            <Button variant="ghost" onClick={close} disabled={status === 'removing'}>
              Cancel
            </Button>
          </div>
          {error !== null && (
            <Text as="p" size="sm">
              {error}
            </Text>
          )}
        </div>
      )}
    </div>
  );
}
