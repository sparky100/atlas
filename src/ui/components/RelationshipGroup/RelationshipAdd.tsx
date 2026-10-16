import { useId, useRef, useState } from 'react';
import type { ElementType, IntegrationProtocol, OwnsRole, RelationshipType, UUID } from '../../../contracts/delta';
import { INTEGRATION_PROTOCOL_LEVELS } from '../../../contracts/relationshipAttributeSchema';
import type { FactsRow, RelationshipsHeadRow } from '../../../contracts/rows';
import type { RelationshipGroupSlot } from '../../../contracts/relationshipTypeRules';
import type { BranchRow } from '../../../db/types';
import { attributesRecord } from '../../elements/attributesRecord';
import { moduleDisplayName } from '../../elements/moduleDisplayName';
import { isIntegrationInterface, isIntegrationPlatform } from '../../elements/systemKind';
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
  /** This element's own type — Prompt 7k item 2's `owns` staged role prompt needs it for the `inbound` direction (elementId is the *owned* side then, so its type, not the picked target's, decides capability-default-vs-system-prompt; `outbound` instead reads the picked target's own type, `PendingTarget.elementType` below). */
  elementType: ElementType;
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
  /** The other endpoint's element id, once creation succeeds — lets the caller mark the new row "just added" (Handoff — Flow: Add a system, step 7) without a second round trip. */
  onCreated: (otherElementId: UUID) => void;
}

const DIRECTION_VERB: Record<RelationshipType, { outbound: string; inbound: string }> = {
  supports: { outbound: 'supports', inbound: 'supported by' },
  owns: { outbound: 'owns', inbound: 'owned by' },
  uses: { outbound: 'uses', inbound: 'used by' },
  flows_to: { outbound: 'flows to', inbound: 'receives from' },
  replaces: { outbound: 'replaces', inbound: 'replaced by' },
  enables: { outbound: 'enables', inbound: 'enabled by' },
};

interface PendingTarget {
  elementId: UUID;
  name: string;
  /** Prompt 7k item 2: which capability/system the picked target is, needed for `owns`' own staged-role decision on the `outbound` direction (see `RelationshipAddProps.elementType`'s own comment). */
  elementType: ElementType;
}

/**
 * One relationship-type group's "+ Add" (Blocking: element creation, per
 * the user's own clarification on where this lives): search-first, no
 * create-new fallback (`useRelationshipTargetSearch`'s own module comment)
 * — pick an existing element of a legal target type, and this element
 * gains a `relationshipType` relationship to it in the given `direction`.
 * Creating one reports the other endpoint's id to `onCreated` (Handoff —
 * Flow: Add a system, step 7's "just added" marking, `RelationshipsSection`'s
 * own `justAddedElementId`) — a plain immediate pick reports it right away;
 * either staged flow below (asking "primary?" or a verb phrase first)
 * reports it once that stage's own create actually lands.
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
 *
 * Check C2 (docs/CHECK-U4-2a.md): that label prompt is a `.labelTextarea`
 * (auto-growing, min 2 rows/max ~8, same `field-sizing: content` technique
 * `AttributeValueInput.module.css`'s own `.textarea` uses for `description`
 * attributes) rather than a single-line `<input>` — a verb phrase is
 * exactly the kind of free text this item names, not a short field like
 * the search box above it.
 *
 * Bug found while touching this same branch for check C2: Sprint U4-1
 * B5's own commit (`e18176b`, "relationship verb label") never actually
 * rendered a "Verb phrase" label — only a `placeholder`, which
 * `e2e/add-a-system-flow.spec.ts`/`e2e/relationship-verb-label.spec.ts`
 * already asserted on (`getByText('Verb phrase')`) and neither test had
 * ever actually been run against a real Supabase (that commit's own
 * message: "written and typechecked, not executed"). Fixed here with a
 * real `<label htmlFor={labelId}>` — a placeholder was never a substitute
 * for one.
 *
 * Prompt 7k item 2 adds a third staged question, for `owns` only, and only
 * when the *owned* side of the edge (never the actor side — `owns` has no
 * role concept for the actor) is a `system` or `container`: "which role?"
 * (business/technical/service) — a platform's own modules are frequently
 * owned by a different business unit than the platform itself (SAP's FI vs
 * PM, Salesforce's CRM vs Field Service), so a module target gets the same
 * prompt a system target does. A capability target skips the question
 * entirely and defaults to `business` (`defaultAttributesForPlainPick`) —
 * the item's own "defaults to business on capability targets, prompts on
 * system targets" wording. Which side is the owned one depends on
 * `direction`: `outbound` picks a target that's the owned side (this
 * control lives on the owning actor's own page), so the picked target's
 * own type decides; `inbound` puts the *current* element at the owned
 * side (this control lives on the owned system/capability's own page,
 * searching for an owning actor), so `elementType` decides instead.
 *
 * Prompt 7k item 4 adds a genuine third stage, for uses/flows_to only,
 * after the mandatory label stage above: "does this go via an
 * integration platform?" - a second search-first picker (`viaSearch`,
 * scoped to systems of kind integration_platform, C18's own requirement)
 * with a prominent skip option, since `via` is optional and most edges
 * won't have one. `showViaStage` is the real stage discriminator this
 * needed (the label stage's own "Add" button becomes "Next", advancing
 * here instead of creating immediately); `asksPrimary`/`asksOwnsRole`
 * never reach this far, since a relationship is only ever supports,
 * owns, or uses/flows_to at once - still enough to keep every other
 * stage's own boolean branch mutually exclusive without a fully
 * generalised stage enum across the whole component.
 */
export function RelationshipAdd({ slot, direction, elementId, elementName, elementType, existingRows, relationshipFacts, modelId, orgId, userId, searchCommitId, branch, expectedHeadCommitId, onCreated }: RelationshipAddProps) {
  const [open, setOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<PendingTarget | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [showViaStage, setShowViaStage] = useState(false);
  // ADR-026: each side's protocol, asked alongside the via pick — both optional.
  const [protocolIn, setProtocolIn] = useState<IntegrationProtocol | ''>('');
  const [protocolOut, setProtocolOut] = useState<IntegrationProtocol | ''>('');
  const protocolInId = useId();
  const protocolOutId = useId();
  const labelId = useId();
  // A target added earlier on this same change (a second new system this
  // element should relate to, say) is otherwise invisible to a main-only
  // search — `useRelationshipTargetSearch`'s own `branchCommitId` doc comment.
  const branchCommitId = branch.kind === 'change' ? branch.head_commit_id : null;
  const search = useRelationshipTargetSearch(searchCommitId, modelId, slot.targetTypes, elementId, true, branchCommitId);
  // V6 (SPEC §5.2, `checkNoDuplicateRelationship` in `src/engine/deltas.ts`):
  // no two live relationships may share `(type, from, to)`. The search pool
  // itself doesn't know this element's own existing edges, so it's filtered
  // out here — picking an already-connected target used to silently create
  // a second, identical edge; now the commit is correctly rejected, so this
  // stays a UI-level guard (never offer what would fail) rather than a
  // confusing engine error the reviewer has no obvious way to act on.
  const existingOtherIds = new Set(existingRows.map((row) => (direction === 'outbound' ? row.to_element_id : row.from_element_id)));
  // F6 (ADR-023): a capability's own outbound `enables` slot searches
  // `value_stream` elements (`slot.targetTypes`, from `RELATIONSHIP_TYPE_RULES`),
  // which is every stream *and* stage — C22 restricts the edge itself to a
  // stage (a `value_stream` with a non-null `parent_id`), so a stream is
  // filtered out here, client-side, rather than ever offered and rejected
  // at commit time. The inbound direction (a stage's own "enabled by"
  // picker) already only ever searches `capability` elements — nothing to
  // narrow there.
  const isEnablesStageSlot = slot.relationshipType === 'enables' && direction === 'outbound';
  const availableResults = search.results.filter((result) => !existingOtherIds.has(result.element_id)).filter((result) => !isEnablesStageSlot || result.parent_id !== null);
  const needsLabel = slot.relationshipType === 'uses' || slot.relationshipType === 'flows_to';
  // Only mounted (its own fetch enabled) for uses/flows_to slots — see this
  // hook's own `enabled` doc comment for why every other slot on the same
  // element page must not also pay for a redundant system-pool query.
  // ADR-026: containers too, so an interface on a platform (a container
  // whose parent is an integration platform) can be the via.
  const viaSearch = useRelationshipTargetSearch(searchCommitId, modelId, ['system', 'container'], elementId, needsLabel, branchCommitId);
  // Set right before each `create()` call so the hook's own success callback
  // (which carries no arguments of its own) can still report which element
  // the new relationship points at (Handoff — Flow: Add a system, step 7).
  const targetIdRef = useRef<UUID | null>(null);
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
      setShowViaStage(false);
      setProtocolIn('');
      setProtocolOut('');
      if (targetIdRef.current) onCreated(targetIdRef.current);
    },
  });

  const asksPrimary = slot.relationshipType === 'supports' && direction === 'outbound' && existingRows.length > 0;

  // See this component's own doc comment for why `direction` picks which
  // side's type decides.
  function ownedElementTypeFor(target: PendingTarget): ElementType {
    return direction === 'outbound' ? target.elementType : elementType;
  }
  const asksOwnsRole = slot.relationshipType === 'owns' && pendingTarget !== null && (ownedElementTypeFor(pendingTarget) === 'system' || ownedElementTypeFor(pendingTarget) === 'container');

  function currentPrimaryDemotion(): RelationshipCreateDemotion | null {
    const currentPrimary = existingRows.find((row) => attributesRecord(row.attributes).role === 'primary');
    if (!currentPrimary) return null;
    const previousDeltaId = relationshipFacts.get(currentPrimary.relationship_id)?.get('role')?.delta_id ?? currentPrimary.exists_delta_id;
    return { relationshipId: currentPrimary.relationship_id, previousDeltaId, attribute: 'role', value: 'secondary' };
  }

  function pickResult(target: PendingTarget): void {
    const willAskOwnsRole = slot.relationshipType === 'owns' && (ownedElementTypeFor(target) === 'system' || ownedElementTypeFor(target) === 'container');
    if (asksPrimary || needsLabel || willAskOwnsRole) {
      setPendingTarget(target);
      return;
    }
    targetIdRef.current = target.elementId;
    void create(target.elementId, target.name, defaultAttributesForPlainPick(slot.relationshipType, ownedElementTypeFor(target)));
  }

  function answerPrimary(primary: boolean): void {
    if (!pendingTarget) return;
    targetIdRef.current = pendingTarget.elementId;
    void create(pendingTarget.elementId, pendingTarget.name, { role: primary ? 'primary' : 'secondary' }, primary ? currentPrimaryDemotion() : null);
  }

  // The label stage's own "Add" — no longer creates directly (Prompt 7k
  // item 4): uses/flows_to now have a third stage after this one, so this
  // just advances to it, keeping labelDraft for `finalizeWithVia` below.
  function proceedToViaStage(): void {
    const label = labelDraft.trim();
    if (!pendingTarget || label.length === 0) return;
    setShowViaStage(true);
  }

  /** The via stage's own two exits — a picked platform, or `undefined` for "Skip" (the default, direct edge). Either way the edge is created now, with the label already captured by the previous stage. */
  function finalizeWithVia(via: UUID | undefined): void {
    if (!pendingTarget) return;
    targetIdRef.current = pendingTarget.elementId;
    const description = labelDraft.trim();
    const protocols = { ...(protocolIn !== '' ? { protocolIn } : {}), ...(protocolOut !== '' ? { protocolOut } : {}) };
    void create(pendingTarget.elementId, pendingTarget.name, via ? { description, via, ...protocols } : { description });
  }

  function answerOwnsRole(role: OwnsRole): void {
    if (!pendingTarget) return;
    targetIdRef.current = pendingTarget.elementId;
    void create(pendingTarget.elementId, pendingTarget.name, { role });
  }

  // Distinct from `close`: backs out of the primary/label stage to the
  // search results (`open` stays true), rather than closing the whole "+
  // Add" control — the search the user already typed is still there.
  function cancelPending(): void {
    setPendingTarget(null);
    setLabelDraft('');
    setShowViaStage(false);
  }

  // The via stage's own "Back" — returns to the label stage (keeping the
  // target and the label already typed), distinct from `cancelPending`
  // above, which drops all the way back to search.
  function backToLabelStage(): void {
    setShowViaStage(false);
  }

  const close = () => {
    setOpen(false);
    setPendingTarget(null);
    setLabelDraft('');
    setShowViaStage(false);
    setProtocolIn('');
    setProtocolOut('');
  };

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

  if (pendingTarget && needsLabel && !showViaStage) {
    return (
      <div className={styles.panel}>
        <Text as="p" size="sm">
          What does this {slot.relationshipType === 'uses' ? 'use' : 'flow'} do? ({DIRECTION_VERB[slot.relationshipType][direction]} {pendingTarget.name})
        </Text>
        <label htmlFor={labelId}>
          <Text as="span" size="sm" tone="muted">
            Verb phrase
          </Text>
        </label>
        <textarea
          id={labelId}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- picking a target is the request to type its label next.
          autoFocus
          rows={2}
          className={styles.labelTextarea}
          placeholder="e.g. reads customer records from"
          value={labelDraft}
          onChange={(e) => { setLabelDraft(e.target.value); }}
        />
        <div className={styles.actions}>
          <Button variant="secondary" onClick={proceedToViaStage} disabled={labelDraft.trim().length === 0}>
            Next
          </Button>
          <Button variant="ghost" onClick={cancelPending} disabled={status === 'creating'}>
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

  if (pendingTarget && needsLabel && showViaStage) {
    const platformResults = viaSearch.results.filter((el) => el.element_id !== pendingTarget.elementId && (el.element_type === 'system' ? isIntegrationPlatform(el) : isIntegrationInterface(el, viaSearch.resultParents.get(el.element_id) ?? null)));
    return (
      <div className={styles.panel}>
        <Text as="p" size="sm">
          Does this go via an integration platform?
        </Text>
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- reaching this stage is the request to type a platform search next.
          autoFocus
          type="text"
          className={styles.input}
          placeholder="Search platforms and interfaces…"
          value={viaSearch.query}
          onChange={(e) => { viaSearch.setQuery(e.target.value); }}
        />
        <div className={styles.protocolRow}>
          <label htmlFor={protocolInId}>
            <Text as="span" size="sm" tone="muted">
              Protocol in
            </Text>
          </label>
          <select id={protocolInId} className={styles.input} value={protocolIn} onChange={(e) => { setProtocolIn(e.target.value as IntegrationProtocol | ''); }}>
            <option value="">Not recorded</option>
            {INTEGRATION_PROTOCOL_LEVELS.map((level) => (
              <option key={level.key} value={level.key}>
                {level.label}
              </option>
            ))}
          </select>
          <label htmlFor={protocolOutId}>
            <Text as="span" size="sm" tone="muted">
              Protocol out
            </Text>
          </label>
          <select id={protocolOutId} className={styles.input} value={protocolOut} onChange={(e) => { setProtocolOut(e.target.value as IntegrationProtocol | ''); }}>
            <option value="">Not recorded</option>
            {INTEGRATION_PROTOCOL_LEVELS.map((level) => (
              <option key={level.key} value={level.key}>
                {level.label}
              </option>
            ))}
          </select>
        </div>
        {viaSearch.status === 'loading' && (
          <Text as="p" tone="muted" size="sm">
            Loading…
          </Text>
        )}
        {viaSearch.status === 'ready' && viaSearch.query.trim().length > 0 && platformResults.length === 0 && (
          <Text as="p" tone="muted" size="sm">
            No integration platforms or interfaces match.
          </Text>
        )}
        {platformResults.length > 0 && (
          <ul className={styles.results}>
            {platformResults.map((platform) => (
              <li key={platform.element_id}>
                <button type="button" className={styles.resultRow} disabled={status === 'creating'} onClick={() => { finalizeWithVia(platform.element_id); }}>
                  <ElementTypeGlyph type={platform.element_type} />
                  <Text as="span">{moduleDisplayName(platform, viaSearch.resultParents.get(platform.element_id) ?? null)}</Text>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => { finalizeWithVia(undefined); }} disabled={status === 'creating'}>
            {status === 'creating' ? 'Adding…' : 'Skip — direct edge'}
          </Button>
          <Button variant="ghost" onClick={backToLabelStage} disabled={status === 'creating'}>
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

  if (pendingTarget && asksOwnsRole) {
    const ownerName = direction === 'outbound' ? elementName : pendingTarget.name;
    const ownedName = direction === 'outbound' ? pendingTarget.name : elementName;
    return (
      <div className={styles.panel}>
        <Text as="p" size="sm">
          What role does {ownerName} have for {ownedName}?
        </Text>
        <Text as="p" tone="muted" size="sm">
          A system or module can have up to three owners at once — one business, one technical, one service.
        </Text>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => { answerOwnsRole('business'); }} disabled={status === 'creating'}>
            {status === 'creating' ? 'Adding…' : 'Business'}
          </Button>
          <Button variant="secondary" onClick={() => { answerOwnsRole('technical'); }} disabled={status === 'creating'}>
            Technical
          </Button>
          <Button variant="secondary" onClick={() => { answerOwnsRole('service'); }} disabled={status === 'creating'}>
            Service
          </Button>
          <Button variant="ghost" onClick={cancelPending} disabled={status === 'creating'}>
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
      {search.status === 'ready' && search.query.trim().length > 0 && availableResults.length === 0 && (
        <Text as="p" tone="muted" size="sm">
          Nothing matches.
        </Text>
      )}
      {availableResults.length > 0 && (
        <ul className={styles.results}>
          {availableResults.map((result) => (
            <li key={result.element_id}>
              <button type="button" className={styles.resultRow} disabled={status === 'creating'} onClick={() => { pickResult({ elementId: result.element_id, name: moduleDisplayName(result, search.resultParents.get(result.element_id) ?? null), elementType: result.element_type }); }}>
                <ElementTypeGlyph type={result.element_type} />
                {/* "Platform · Module" — freezes into `PendingTarget.name` at pick time, so every downstream confirmation/commit-title use of it stays qualified too. */}
                <Text as="span">{moduleDisplayName(result, search.resultParents.get(result.element_id) ?? null)}</Text>
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
