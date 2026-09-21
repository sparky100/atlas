import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { ElementType, RelationshipType, UUID } from '../../../contracts/delta';
import type { FactsRow, RelationshipsHeadRow, ElementsHeadRow } from '../../../contracts/rows';
import { inboundRelationshipGroups, outboundRelationshipGroups, type RelationshipGroupSlot } from '../../../contracts/relationshipTypeRules';
import { RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE } from '../../../contracts/relationshipAttributeSchema';
import type { BranchRow, SourceRow } from '../../../db/types';
import { attributesRecord } from '../../elements/attributesRecord';
import { fitForPurposeToneFor, isFitForPurpose } from '../../elements/fitForPurposeTone';
import { useRelationshipEditor } from '../../elements/useRelationshipEditor';
import { AttributeEditRow } from '../AttributeEditRow/AttributeEditRow';
import { AttributeRow } from '../AttributeRow/AttributeRow';
import { Button } from '../Button/Button';
import { Chip } from '../Chip/Chip';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../EmptyState/EmptyState';
import { FactBadge } from '../FactBadge/FactBadge';
import { endpointDisplayName } from './relationshipEndpointLabel';
import { RelationshipAdd } from './RelationshipAdd';
import { RelationshipRemove, type RelationshipsSectionRemoveConfig } from './RelationshipRemove';
import { Text } from '../Text/Text';
import styles from './RelationshipsSection.module.css';

// Fixed display order (UI-principles §4.4) — distinct from RELATIONSHIP_TYPES'
// wire-contract listing order, which doesn't itself mandate a UI order.
const DISPLAY_ORDER: RelationshipType[] = ['supports', 'owns', 'uses', 'flows_to', 'enables'];

const DIRECTION_LABEL: Record<RelationshipType, { outbound: string; inbound: string }> = {
  supports: { outbound: 'supports', inbound: 'supported by' },
  owns: { outbound: 'owns', inbound: 'owned by' },
  uses: { outbound: 'uses', inbound: 'used by' },
  flows_to: { outbound: 'flows to', inbound: 'receives from' },
  // ADR-001 amendment ("replaces") — not yet in DISPLAY_ORDER below, so this
  // entry exists only to satisfy the exhaustive Record; the "Replaces"/
  // "Replaced by" sections don't render on the element page until a later
  // PR adds 'replaces' to DISPLAY_ORDER and covers the rendering behaviour.
  replaces: { outbound: 'replaces', inbound: 'replaced by' },
  // F6 (ADR-023): a capability's "Enables" group and a stage's "Enabled by" group both come from this one entry plus the rules row.
  enables: { outbound: 'enables', inbound: 'enabled by' },
};

/** Everything `RelationshipAdd` needs beyond the group slot itself and direction — one object so `RelationshipsSection`'s own prop list doesn't grow one entry per field every time the create path needs another. Omitted entirely (not passed disabled) when the caller hasn't established edit rights, same convention as `CapabilityMapView`'s `reorderCapability`. */
export interface RelationshipsSectionAddConfig {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** This element's own name — only for the generated commit title (`useRelationshipCreate`'s own doc comment). */
  elementName: string;
  searchCommitId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  /** The newly related element's id — the caller (ElementPage.tsx) uses this to mark the row "just added" (Handoff — Flow: Add a system, step 7). */
  onCreated: (otherElementId: UUID) => void;
}

/**
 * Relationship attribute editing, general: everything a row's own expanded
 * panel needs to edit it (`useRelationshipEditor.ts`) — one object, same
 * convention as `RelationshipsSectionAddConfig`/`RelationshipsSectionRemoveConfig`.
 * Omitted entirely (not shown disabled) when the caller hasn't established
 * edit rights; expanding a row to *view* its attributes needs none of
 * this and is always available regardless.
 */
export interface RelationshipsSectionEditConfig {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onSaved: () => void;
}

export interface RelationshipsSectionProps {
  orgSlug: string;
  modelSlug: string;
  elementId: UUID;
  elementType: ElementType;
  /** This element's own current name — "Relationship removal"'s confirmation sentence subject (`elementName` on `addRelationship` already carries this for the create side; the remove side needs it unconditionally, even when `removeRelationship` is the only config given). */
  elementName: string;
  relationships: RelationshipsHeadRow[];
  endpoints: Map<UUID, ElementsHeadRow>;
  relationshipFacts: Map<UUID, Map<string, FactsRow>>;
  sources: Map<UUID, SourceRow>;
  addRelationship?: RelationshipsSectionAddConfig | undefined;
  /** "Relationship removal": each row's own "⋯ Remove" — omitted entirely (not shown disabled) when the caller hasn't established edit rights, same convention as `addRelationship`. */
  removeRelationship?: RelationshipsSectionRemoveConfig | undefined;
  /** Relationship attribute editing, general — omitted entirely (not shown disabled) when the caller hasn't established edit rights, same convention as `addRelationship`/`removeRelationship`. */
  editRelationship?: RelationshipsSectionEditConfig | undefined;
  /** The other element id of a relationship just added in this session (Handoff — Flow: Add a system, step 7's `just added` chip) — cleared by the caller once acknowledged, not by this component. */
  justAddedElementId?: UUID | null;
}

/**
 * Blocking: element creation generalised this from a pure read-only list to
 * also enumerate every relationship-type/direction slot `elementType` can
 * legally have (`RELATIONSHIP_TYPE_RULES`, via `outboundRelationshipGroups`/
 * `inboundRelationshipGroups`) — not just the ones with existing rows — so
 * a slot with nothing in it yet still gets its own "+ Add" (per the user's
 * own clarification on where relationship creation lives: "A '+ Add' under
 * each relationship-type group the element is allowed to have"). A slot
 * with neither existing rows nor (when `addRelationship` is given) the
 * right to add is skipped entirely, same as before this generalisation.
 *
 * Relationship attribute editing, general: every row expands (the ▸/▾
 * toggle) to its own attributes-with-provenance panel — `RelationshipRow`
 * below, one `AttributeRow`/`AttributeEditRow` per field, the exact same
 * components (and therefore the exact same look, keyboard behaviour, and
 * validation) `ElementPage.tsx`'s own Attributes section already uses for
 * an element. Expanding to *view* needs no permission; `editRelationship`
 * (omitted entirely when the caller hasn't established edit rights, same
 * convention as `addRelationship`/`removeRelationship`) is what turns the
 * panel's own "Edit" button on.
 */
export function RelationshipsSection({
  orgSlug,
  modelSlug,
  elementId,
  elementType,
  elementName,
  relationships,
  endpoints,
  relationshipFacts,
  sources,
  addRelationship,
  removeRelationship,
  editRelationship,
  justAddedElementId = null,
}: RelationshipsSectionProps) {
  const outboundSlots = new Map(outboundRelationshipGroups(elementType).map((slot) => [slot.relationshipType, slot]));
  const inboundSlots = new Map(inboundRelationshipGroups(elementType).map((slot) => [slot.relationshipType, slot]));

  const groups = DISPLAY_ORDER.map((type) => {
    const outboundRows = relationships.filter((r) => r.relationship_type === type && r.from_element_id === elementId);
    const inboundRows = relationships.filter((r) => r.relationship_type === type && r.to_element_id === elementId);
    const outboundSlot = outboundSlots.get(type);
    const inboundSlot = inboundSlots.get(type);
    const showOutbound = outboundRows.length > 0 || (addRelationship !== undefined && outboundSlot !== undefined);
    const showInbound = inboundRows.length > 0 || (addRelationship !== undefined && inboundSlot !== undefined);
    return { type, outboundRows, inboundRows, outboundSlot, inboundSlot, showOutbound, showInbound };
  }).filter((group) => group.showOutbound || group.showInbound);

  if (groups.length === 0) {
    return <EmptyState>No relationships recorded for this element yet.</EmptyState>;
  }

  return (
    <div>
      {groups.map(({ type, outboundRows, inboundRows, outboundSlot, inboundSlot, showOutbound, showInbound }) => (
        <div key={type} className={styles.typeGroup}>
          {showOutbound && (
            <RelationshipDirectionGroup
              label={DIRECTION_LABEL[type].outbound}
              rows={outboundRows}
              direction="outbound"
              slot={outboundSlot}
              elementId={elementId}
              elementType={elementType}
              elementName={elementName}
              orgSlug={orgSlug}
              modelSlug={modelSlug}
              endpoints={endpoints}
              relationshipFacts={relationshipFacts}
              sources={sources}
              addRelationship={addRelationship}
              removeRelationship={removeRelationship}
              editRelationship={editRelationship}
              justAddedElementId={justAddedElementId}
            />
          )}
          {showInbound && (
            <RelationshipDirectionGroup
              label={DIRECTION_LABEL[type].inbound}
              rows={inboundRows}
              direction="inbound"
              slot={inboundSlot}
              elementId={elementId}
              elementType={elementType}
              elementName={elementName}
              orgSlug={orgSlug}
              modelSlug={modelSlug}
              endpoints={endpoints}
              relationshipFacts={relationshipFacts}
              sources={sources}
              addRelationship={addRelationship}
              removeRelationship={removeRelationship}
              editRelationship={editRelationship}
              justAddedElementId={justAddedElementId}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function RelationshipDirectionGroup({
  label,
  rows,
  direction,
  slot,
  elementId,
  elementType,
  elementName,
  orgSlug,
  modelSlug,
  endpoints,
  relationshipFacts,
  sources,
  addRelationship,
  removeRelationship,
  editRelationship,
  justAddedElementId,
}: {
  label: string;
  rows: RelationshipsHeadRow[];
  direction: 'outbound' | 'inbound';
  slot: RelationshipGroupSlot | undefined;
  elementId: UUID;
  elementType: ElementType;
  elementName: string;
  orgSlug: string;
  modelSlug: string;
  endpoints: Map<UUID, ElementsHeadRow>;
  relationshipFacts: Map<UUID, Map<string, FactsRow>>;
  sources: Map<UUID, SourceRow>;
  addRelationship?: RelationshipsSectionAddConfig | undefined;
  removeRelationship?: RelationshipsSectionRemoveConfig | undefined;
  editRelationship?: RelationshipsSectionEditConfig | undefined;
  justAddedElementId?: UUID | null;
}) {
  // Auto-demote candidates for a `supports.role` promotion (`useRelationshipEditor.ts`'s
  // own module comment) only ever come from this same outbound group — the
  // one place every row shares this element's own `from_element_id`, the
  // anchor a single `primary` is scoped to.
  const siblingSupportsRows = direction === 'outbound' && rows.length > 0 && rows[0]?.relationship_type === 'supports' ? rows : [];

  return (
    <div className={styles.directionGroup}>
      <Text as="h3" size="md" className={styles.groupLabel}>
        {label} <Text as="span" tone="muted">({rows.length})</Text>
      </Text>
      {rows.map((rel) => {
        const otherId = direction === 'outbound' ? rel.to_element_id : rel.from_element_id;
        const other = endpoints.get(otherId);
        const facts = relationshipFacts.get(rel.relationship_id) ?? new Map<string, FactsRow>();
        const existsFact = facts.get('$exists');
        const attrs = attributesRecord(rel.attributes);
        const dataClassification = attrs.dataClassification;
        // Prompt 7k item 2: owns.role replaces owns.primary — the row shows
        // which role this owns edge asserts (a target can have up to three
        // owners at once, one per role), not a single ★ "the owner" marker.
        const ownsRole = rel.relationship_type === 'owns' && typeof attrs.role === 'string' ? attrs.role : null;
        // Relationship attribute editing, general — "Role tags at both
        // ends (system page, capability page)": the same row component
        // renders on a system's own outbound `supports` group and a
        // capability's inbound one, so one chip here covers both.
        const supportsRole = rel.relationship_type === 'supports' && typeof attrs.role === 'string' ? attrs.role : null;
        // Fit-for-purpose: the supports edge's own leaf-level rating — shown
        // on the row itself (never rolled up here; the capability map's own
        // colour-by is what rolls it up), the same "one chip covers both the
        // system's outbound and the capability's inbound group" reasoning
        // `supportsRole` just above already gives.
        const fitForPurpose = rel.relationship_type === 'supports' && typeof attrs.fitForPurpose === 'string' && isFitForPurpose(attrs.fitForPurpose) ? attrs.fitForPurpose : null;
        // The verb-phrase label (Sprint U4-1 B5: required at creation for
        // uses/flows_to, optional elsewhere) — shown whenever one exists,
        // not gated to those two types, since `description` is the same
        // free-text attribute on every relationship type and nothing else
        // in this row surfaces it otherwise.
        const description = attrs.description;
        const justAdded = other !== undefined && other.element_id === justAddedElementId;
        // "Platform · Module" for a container endpoint — `endpoints`
        // carries the parent alongside every container endpoint now
        // (`useElementPage.ts`'s own fetch), so this is a lookup, never a
        // second round trip.
        const otherDisplayName = other ? endpointDisplayName(other, endpoints) : '';

        return (
          <div key={rel.relationship_id} className={styles.rowGroup}>
            <div className={styles.row}>
              <span className={styles.arrow} aria-hidden="true">
                {direction === 'outbound' ? '→' : '←'}
              </span>
              {other ? (
                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${other.element_id}`} className={styles.endpointLink}>
                  <ElementTypeGlyph type={other.element_type} />
                  <Text as="span">{otherDisplayName}</Text>
                </Link>
              ) : (
                <Text as="span" tone="faint">
                  (unknown element)
                </Text>
              )}
              <Text tone="muted" size="sm" as="span">
                {other?.element_type ?? ''}
              </Text>
              {typeof description === 'string' && description.trim().length > 0 && (
                <Text tone="muted" size="sm" as="span">
                  “{description}”
                </Text>
              )}
              {supportsRole !== null && <Chip tone={supportsRole === 'primary' ? 'info' : 'neutral'}>{supportsRole}</Chip>}
              {fitForPurpose !== null && <Chip tone={fitForPurposeToneFor(fitForPurpose)}>{fitForPurpose}</Chip>}
              {ownsRole !== null && <Chip tone="neutral">{ownsRole} owner</Chip>}
              {typeof dataClassification === 'string' && dataClassification.length > 0 && <Chip tone="info">{dataClassification}</Chip>}
              {justAdded && <Chip tone="info">just added</Chip>}
              {existsFact && <FactBadge fact={existsFact} source={sources.get(existsFact.source_id)} />}
              {removeRelationship && (
                <RelationshipRemove
                  relationship={rel}
                  direction={direction}
                  elementName={elementName}
                  otherName={other ? otherDisplayName : undefined}
                  siblingRows={rows}
                  endpoints={endpoints}
                  relationshipFacts={relationshipFacts}
                  config={removeRelationship}
                />
              )}
            </div>
            <RelationshipAttributesPanel
              relationship={rel}
              facts={facts}
              sources={sources}
              via={typeof attrs.via === 'string' ? endpoints.get(attrs.via) : undefined}
              orgSlug={orgSlug}
              modelSlug={modelSlug}
              siblingSupportsRows={siblingSupportsRows}
              editRelationship={editRelationship}
            />
          </div>
        );
      })}
      {addRelationship && slot && (
        <RelationshipAdd
          slot={slot}
          direction={direction}
          elementId={elementId}
          elementType={elementType}
          elementName={addRelationship.elementName}
          existingRows={rows}
          relationshipFacts={relationshipFacts}
          modelId={addRelationship.modelId}
          orgId={addRelationship.orgId}
          userId={addRelationship.userId}
          searchCommitId={addRelationship.searchCommitId}
          branch={addRelationship.branch}
          expectedHeadCommitId={addRelationship.expectedHeadCommitId}
          onCreated={addRelationship.onCreated}
        />
      )}
    </div>
  );
}

interface RelationshipAttributesPanelProps {
  relationship: RelationshipsHeadRow;
  facts: Map<string, FactsRow>;
  sources: Map<UUID, SourceRow>;
  via: ElementsHeadRow | undefined;
  orgSlug: string;
  modelSlug: string;
  siblingSupportsRows: readonly RelationshipsHeadRow[];
  editRelationship?: RelationshipsSectionEditConfig | undefined;
}

/**
 * One relationship's own expanded attributes — role/description/data
 * classification, each with the same provenance badge an element's own
 * Attributes section shows, plus `via` (resolved to a link, never run
 * through the generic schema — see `relationshipAttributeSchema.ts`'s own
 * module comment for why). Read-only by default; `editRelationship` turns
 * on the same `Edit`/`Save`/`Cancel` shape `ElementPage.tsx`'s
 * `AttributesTable`/`AttributesEditor` toggle already uses, via
 * `useRelationshipEditor.ts`.
 */
function RelationshipAttributesPanel({ relationship, facts, sources, via, orgSlug, modelSlug, siblingSupportsRows, editRelationship }: RelationshipAttributesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const toggleId = useId();
  const schema = RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE[relationship.relationship_type];

  const editor = useRelationshipEditor({
    modelId: editRelationship?.modelId ?? '',
    orgId: editRelationship?.orgId ?? '',
    userId: editRelationship?.userId ?? null,
    relationship,
    facts,
    siblingSupportsRows,
    branch: editRelationship?.branch ?? PLACEHOLDER_BRANCH,
    expectedHeadCommitId: editRelationship?.expectedHeadCommitId ?? '',
    onSaved: () => editRelationship?.onSaved(),
  });
  const editing = editRelationship !== undefined && editor.status !== 'idle';

  return (
    <>
      <button
        type="button"
        className={styles.expandToggle}
        aria-expanded={expanded}
        aria-controls={toggleId}
        onClick={() => {
          setExpanded((e) => !e);
        }}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <Text as="span" size="sm" tone="muted">
          {expanded ? 'Hide attributes' : 'Show attributes'}
        </Text>
      </button>
      {expanded && (
        <div id={toggleId} className={styles.attributesPanel}>
          {!editing &&
            schema.map((field) => {
              const fact = facts.get(field.key);
              return <AttributeRow key={field.key} label={field.label} required={field.required} fact={fact} source={fact ? sources.get(fact.source_id) : undefined} />;
            })}
          {editing &&
            schema
              .filter((field) => field.editable !== false)
              .map((field) => {
                if (!editor.fieldEditable(field.key)) {
                  return (
                    <div key={field.key} className={styles.lockedField}>
                      <Text tone="muted" as="span">
                        {field.label}
                      </Text>
                      <Text as="span" size="sm">
                        primary — promote a different {relationship.relationship_type} edge to change this
                      </Text>
                    </div>
                  );
                }
                return (
                  <AttributeEditRow
                    key={field.key}
                    field={field}
                    value={editor.values[field.key] ?? ''}
                    onChange={(value) => {
                      editor.setValue(field.key, value);
                    }}
                    error={editor.fieldErrors[field.key]}
                  />
                );
              })}
          {via && (
            <div className={styles.viaRow}>
              <Text tone="muted" as="span">
                Via
              </Text>
              <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${via.element_id}`} className={styles.endpointLink}>
                <ElementTypeGlyph type={via.element_type} />
                <Text as="span">{via.name}</Text>
              </Link>
            </div>
          )}
          {editRelationship && !editing && (
            <Button variant="secondary" onClick={editor.startEditing}>
              Edit
            </Button>
          )}
          {editing && (
            <div className={styles.editorActions}>
              <Button variant="secondary" onClick={() => void editor.save()} disabled={editor.status === 'submitting' || !editor.hasChanges}>
                {editor.status === 'submitting' ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" onClick={editor.cancelEditing} disabled={editor.status === 'submitting'}>
                Cancel
              </Button>
              {editor.submitError !== null && (
                <Text as="p" tone="default">
                  {editor.submitError}
                </Text>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// useRelationshipEditor is only actually invoked (its startEditing/save
// reached) once `editRelationship` is real — this placeholder only exists
// so the hook, which the Rules of Hooks require to run every render, not
// conditionally, always has a BranchRow to close over while no edit config
// was given. Same pattern ElementPage.tsx's own PLACEHOLDER_BRANCH uses.
const PLACEHOLDER_BRANCH: BranchRow = {
  id: '',
  org_id: '',
  model_id: '',
  name: '',
  kind: 'main',
  status: 'draft',
  base_commit_id: '',
  head_commit_id: '',
  shared_for_review: false,
  title: null,
  description: null,
  target_date: null,
  split_from: null,
  created_by: '',
  updated_at: '',
  cancel_reason: null,
  cancelled_at: null,
  cancelled_by: null,
  dismissed_identity_pairs: [],
  intent: null,
};
