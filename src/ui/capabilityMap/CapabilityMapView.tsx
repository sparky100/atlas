import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { BranchRow } from '../../db/types';
import { CapabilityTile } from '../components/CapabilityTile/CapabilityTile';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { CapabilityMapAddForm } from './CapabilityMapAddForm';
import { COLOUR_BY_OPTIONS, supportingSystemIds, tileColourFor, type ColourByMode } from './metrics';
import type { CapabilityMapTree, L1Column, L2Card } from './layout';
import { useCapabilityReorder } from './useCapabilityReorder';
import styles from './CapabilityMapView.module.css';

/** Shape shared by `addCapability` and `reorderCapability` — both are "does the caller have edit rights, and what do we need to commit through them" (Sprint U4-1 C1 adds the second one). */
export interface CapabilityMapEditContext {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
}

export interface CapabilityMapViewProps {
  tree: CapabilityMapTree;
  supportsEdges: RelationshipsHeadRow[];
  systemsById: Map<UUID, ElementsHeadRow>;
  orgSlug: string;
  modelSlug: string;
  /** `?ref=...` — carried into every "→ Landscape" zoom link so it lands on the same ref the map itself is showing (§2.4's deep-link rule). */
  refParam: string;
  /**
   * The tailoring flow's "add" action (§4.2-style gate: owner/architect, at
   * `main` — ADR-015). Omitted entirely, not shown disabled, when the
   * caller hasn't established both halves — same convention as
   * ElementHeader's `onEdit`.
   */
  addCapability?: (CapabilityMapEditContext & { onCreated: () => void }) | undefined;
  /**
   * Sprint U4-1 C1's "drag-to-reorder among siblings" — same edit-rights
   * gate as `addCapability` (in practice, always given together — both
   * come from `CapabilityMapPage.tsx`'s one `canEdit` check — but kept as
   * a separate prop rather than folded into `addCapability` since the two
   * really are different actions with different callbacks).
   */
  reorderCapability?: (CapabilityMapEditContext & { onReordered: () => void }) | undefined;
}

/**
 * The capability map's renderer (UI-principles §6.1, §3.1): nested tiles —
 * L1 as columns, L2 as stacked cards, L3 revealed inline on expand. Plain
 * DOM/CSS, not Canvas — see src/ui/capabilityMap/layout.ts's module
 * comment for why. Colour-by (src/ui/capabilityMap/metrics.ts) is a
 * toolbar toggle, defaulting to `none`; every mode still shows the
 * supporting-system count as text regardless (§4.3-style "never
 * colour-only").
 *
 * Sprint U2 step 3: every tile's supporting-system count is now also the
 * zoom chain's entry point — a link to the landscape filtered to exactly
 * those systems (UI-principles §2.1's "capability map → landscape"), the
 * same exact-match set the count itself already names
 * (src/ui/capabilityMap/metrics.ts's `supportingSystemIds`). A tile with
 * zero supporting systems gets no link — there's nowhere to zoom to.
 *
 * Playwright coverage: e2e/capability-map.spec.ts (Sprint U2 step 4 —
 * deferred there from step 1 at the user's own request, one step later
 * than originally scheduled), covering a two-level tree with an orphan,
 * expanding an L2 to reveal L3, and a colour-by switch actually changing
 * a tile's tone.
 *
 * Sprint U4-1 C2: the L1 row (`.columns`) is a responsive CSS grid, not a
 * horizontally-scrolling one — see CapabilityMapView.module.css's own
 * comment for the breakpoint tiers. `role="list"`/`role="listitem"` on the
 * grid and each L1 column give it real list semantics (there was no
 * accessible structure here before — a bare `<div>` grid of tiles reads
 * as nothing in particular to a screen reader) and, as a side effect,
 * something e2e/capability-map-layout.spec.ts can query without a
 * CSS-module class selector. Column count itself is asserted there via
 * `getComputedStyle(...).gridTemplateColumns` at each breakpoint, plus a
 * no-horizontal-scroll check at the narrowest (390px).
 *
 * Sprint U4-1 C3: L2 cards and L3 tiles are both the shared
 * `CapabilityTile` component (`src/ui/components/CapabilityTile/
 * CapabilityTile.tsx` — that file's own comment has the full design:
 * blueprint-framed, plain-text name, whole tile as the click target,
 * colour-by tone filling the tile rather than sitting in a separate
 * chip alone). Not L1: an L1 column holds several independently-
 * clickable L2 cards, not one clickable unit, and doesn't participate in
 * colour-by — see `L1ColumnView`'s own header markup below, unchanged by
 * C3.
 */
export function CapabilityMapView({ tree, supportsEdges, systemsById, orgSlug, modelSlug, refParam, addCapability, reorderCapability }: CapabilityMapViewProps) {
  const [colourBy, setColourBy] = useState<ColourByMode>('none');
  const [expanded, setExpanded] = useState<Set<UUID>>(new Set());
  const colourById = useId();

  function toggleExpanded(id: UUID): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (tree.l1.length === 0 && tree.orphans.length === 0) {
    return (
      <div>
        <EmptyState>No capabilities yet. A capability map has nothing to show until at least one Capability element exists.</EmptyState>
        {addCapability && (
          <div className={styles.toolbar}>
            <CapabilityMapAddForm tree={tree} {...addCapability} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.toolbar}>
        <label htmlFor={colourById}>
          <Text as="span" size="sm" tone="muted">
            Colour by
          </Text>
        </label>
        <select id={colourById} className={styles.select} value={colourBy} onChange={(e) => { setColourBy(e.target.value as ColourByMode); }}>
          <option value="none">None</option>
          {COLOUR_BY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {addCapability && <CapabilityMapAddForm tree={tree} {...addCapability} />}
      </div>

      {tree.l1.length > 0 && (
        <div className={styles.columns} role="list" aria-label="Level 1 capabilities">
          {tree.l1.map((column, index) => (
            <L1ColumnView
              key={column.capability.element_id}
              column={column}
              colourBy={colourBy}
              supportsEdges={supportsEdges}
              systemsById={systemsById}
              orgSlug={orgSlug}
              modelSlug={modelSlug}
              refParam={refParam}
              expanded={expanded}
              onToggleExpand={toggleExpanded}
              previousSibling={tree.l1[index - 1]?.capability}
              nextSibling={tree.l1[index + 1]?.capability}
              reorderCapability={reorderCapability}
            />
          ))}
        </div>
      )}

      {tree.orphans.length > 0 && (
        <div className={styles.orphans}>
          <Text as="p" tone="muted">
            {tree.orphans.length} capabilit{tree.orphans.length === 1 ? 'y has' : 'ies have'} a broken or too-deep parent chain and can&rsquo;t be placed on the map:
          </Text>
          <ul>
            {tree.orphans.map((capability) => (
              <li key={capability.element_id}>
                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${capability.element_id}`}>{capability.name}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The "→ Landscape" zoom link every tile shows next to its supporting-system count — `null` (rendered as nothing) when there are none to zoom into. */
function LandscapeZoomLink({ capabilityId, count, orgSlug, modelSlug, refParam }: { capabilityId: UUID; count: number; orgSlug: string; modelSlug: string; refParam: string }) {
  if (count === 0) return null;
  const href = `/o/${orgSlug}/m/${modelSlug}/landscape?${new URLSearchParams({ ref: refParam, capability: capabilityId }).toString()}`;
  return (
    <Link to={href} className={styles.zoomLink}>
      <Text as="span" tone="faint" size="sm">
        {count} system{count === 1 ? '' : 's'} →
      </Text>
    </Link>
  );
}

/**
 * Sprint U4-1 C1's "drag-to-reorder among siblings" (`useCapabilityReorder`'s
 * own module comment explains why buttons, not a mouse drag). `previous`/
 * `next` are this capability's immediate siblings in display order
 * (`compareCapabilities`) — `undefined` at either end of the list, which
 * disables the matching button rather than wrapping around; that's the
 * only reason a button is ever disabled here — every capability gets an
 * `order` at creation now (`useCapabilityCreate.ts`) or via the one-off
 * `scripts/backfillCapabilityOrder.ts` for anything older, so there's no
 * "not orderable yet" state left to show. Mounted only when the caller has
 * edit rights (`L1ColumnView`/`L2CardView` render this conditionally on
 * `reorderCapability`, never with `context` missing) — `useCapabilityReorder`
 * is a real hook, so it can't be called conditionally *inside* one
 * always-mounted component the way a plain `if` can guard a prop;
 * conditional mounting is the correct place for that decision, same as
 * `addCapability`'s sibling `CapabilityMapAddForm`.
 */
function ReorderButtons({
  capability,
  previous,
  next,
  context,
  previousGlyph,
  previousLabel,
  nextGlyph,
  nextLabel,
}: {
  capability: ElementsHeadRow;
  previous: ElementsHeadRow | undefined;
  next: ElementsHeadRow | undefined;
  context: CapabilityMapEditContext & { onReordered: () => void };
  previousGlyph: string;
  previousLabel: string;
  nextGlyph: string;
  nextLabel: string;
}) {
  const { status, error, swap } = useCapabilityReorder(context);

  return (
    <span className={styles.reorderButtons}>
      <button type="button" aria-label={previousLabel} disabled={previous === undefined || status === 'reordering'} onClick={() => { if (previous) void swap(capability, previous); }}>
        {previousGlyph}
      </button>
      <button type="button" aria-label={nextLabel} disabled={next === undefined || status === 'reordering'} onClick={() => { if (next) void swap(capability, next); }}>
        {nextGlyph}
      </button>
      {error !== null && (
        <Text as="span" size="xs">
          {error}
        </Text>
      )}
    </span>
  );
}

function L1ColumnView({
  column,
  colourBy,
  supportsEdges,
  systemsById,
  orgSlug,
  modelSlug,
  refParam,
  expanded,
  onToggleExpand,
  previousSibling,
  nextSibling,
  reorderCapability,
}: {
  column: L1Column;
  colourBy: ColourByMode;
  supportsEdges: RelationshipsHeadRow[];
  systemsById: Map<UUID, ElementsHeadRow>;
  orgSlug: string;
  modelSlug: string;
  refParam: string;
  expanded: Set<UUID>;
  onToggleExpand: (id: UUID) => void;
  previousSibling: ElementsHeadRow | undefined;
  nextSibling: ElementsHeadRow | undefined;
  reorderCapability: (CapabilityMapEditContext & { onReordered: () => void }) | undefined;
}) {
  const count = supportingSystemIds(column.capability.element_id, supportsEdges).length;
  return (
    <div className={styles.column} role="listitem">
      <div className={styles.columnHeader}>
        <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${column.capability.element_id}`}>
          <Text as="span" size="lg">
            {column.capability.name}
          </Text>
        </Link>
        <LandscapeZoomLink capabilityId={column.capability.element_id} count={count} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} />
        {reorderCapability && (
          <ReorderButtons
            capability={column.capability}
            previous={previousSibling}
            next={nextSibling}
            context={reorderCapability}
            previousGlyph="←"
            previousLabel={`Move ${column.capability.name} left`}
            nextGlyph="→"
            nextLabel={`Move ${column.capability.name} right`}
          />
        )}
      </div>
      {column.l2.map((card, index) => (
        <L2CardView
          key={card.capability.element_id}
          card={card}
          colourBy={colourBy}
          supportsEdges={supportsEdges}
          systemsById={systemsById}
          orgSlug={orgSlug}
          modelSlug={modelSlug}
          refParam={refParam}
          expanded={expanded.has(card.capability.element_id)}
          onToggleExpand={onToggleExpand}
          previousSibling={column.l2[index - 1]?.capability}
          nextSibling={column.l2[index + 1]?.capability}
          reorderCapability={reorderCapability}
        />
      ))}
    </div>
  );
}

function L2CardView({
  card,
  colourBy,
  supportsEdges,
  systemsById,
  orgSlug,
  modelSlug,
  refParam,
  expanded,
  onToggleExpand,
  previousSibling,
  nextSibling,
  reorderCapability,
}: {
  card: L2Card;
  colourBy: ColourByMode;
  supportsEdges: RelationshipsHeadRow[];
  systemsById: Map<UUID, ElementsHeadRow>;
  orgSlug: string;
  modelSlug: string;
  refParam: string;
  expanded: boolean;
  onToggleExpand: (id: UUID) => void;
  previousSibling: ElementsHeadRow | undefined;
  nextSibling: ElementsHeadRow | undefined;
  reorderCapability: (CapabilityMapEditContext & { onReordered: () => void }) | undefined;
}) {
  const colour = tileColourFor(colourBy, card.capability.element_id, supportsEdges, systemsById);
  const count = supportingSystemIds(card.capability.element_id, supportsEdges).length;

  return (
    <CapabilityTile href={`/o/${orgSlug}/m/${modelSlug}/e/${card.capability.element_id}`} name={card.capability.name} tone={colour.tone} toneLabel={colour.label}>
      <div className={styles.cardSecondaryRow}>
        {reorderCapability && (
          <ReorderButtons
            capability={card.capability}
            previous={previousSibling}
            next={nextSibling}
            context={reorderCapability}
            previousGlyph="↑"
            previousLabel={`Move ${card.capability.name} up`}
            nextGlyph="↓"
            nextLabel={`Move ${card.capability.name} down`}
          />
        )}
        <LandscapeZoomLink capabilityId={card.capability.element_id} count={count} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} />
        {card.l3.length > 0 && (
          <button type="button" className={styles.expandButton} aria-expanded={expanded} onClick={() => { onToggleExpand(card.capability.element_id); }}>
            {expanded ? '▾' : '▸'} {card.l3.length}
          </button>
        )}
      </div>
      {expanded && card.l3.length > 0 && (
        <div className={styles.l3Tiles}>
          {card.l3.map((leaf) => {
            const leafColour = tileColourFor(colourBy, leaf.element_id, supportsEdges, systemsById);
            const leafCount = supportingSystemIds(leaf.element_id, supportsEdges).length;
            return (
              <CapabilityTile
                key={leaf.element_id}
                href={`/o/${orgSlug}/m/${modelSlug}/e/${leaf.element_id}`}
                name={leaf.name}
                tone={leafColour.tone}
                toneLabel={leafColour.label}
                size="compact"
              >
                <LandscapeZoomLink capabilityId={leaf.element_id} count={leafCount} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} />
              </CapabilityTile>
            );
          })}
        </div>
      )}
    </CapabilityTile>
  );
}
