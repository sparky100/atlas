import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { BranchRow } from '../../db/types';
import { CapabilityTile } from '../components/CapabilityTile/CapabilityTile';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { useIsNarrowViewport } from '../landscape/useIsNarrowViewport';
import { COLOUR_BY_OPTIONS, aggregateTileColourFor, supportingSystemIds, tileColourFor, type ColourByMode } from './metrics';
import type { CapabilityMapTree, L1Column, L2Card } from './layout';
import { useCapabilityReorder } from './useCapabilityReorder';
import styles from './CapabilityMapView.module.css';

/**
 * `reorderCapability`'s own "does the caller have edit rights, and what do
 * we need to commit through them" shape (Sprint U4-1 C1). Also used to be
 * `addCapability`'s shape too, before Sprint U4-1 C5 moved "+ Add
 * capability" out of this component entirely, into `CapabilityMapPage.tsx`'s
 * own page-action area — reordering stays a per-tile control rendered
 * inside the map itself, not a page action, so it's the one caller left.
 */
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
  /** Sprint U4-1 C4: the model-wide "does this model have any systems at all" answer — see `useCapabilityMap.ts`'s own `hasSystems` comment for why this isn't derived from `systemsById` above. Drives the "link systems to capabilities to see coverage" hint. */
  hasSystems: boolean;
  /** Sprint U4-1 C4: resolved and persisted by the caller (`useColourByPreference`) — this component no longer owns colour-by as local state, so its default (director→exposure, architect→coverage, none-until-systems-exist) and "remember last choice per user" both live in one place. */
  colourBy: ColourByMode;
  onColourByChange: (mode: ColourByMode) => void;
  orgSlug: string;
  modelSlug: string;
  /** `?ref=...` — carried into every "→ Landscape" zoom link so it lands on the same ref the map itself is showing (§2.4's deep-link rule). */
  refParam: string;
  /**
   * Sprint U4-1 C1's "drag-to-reorder among siblings" (§4.2-style gate:
   * owner/architect, at `main` — ADR-015). Omitted entirely, not shown
   * disabled, when the caller hasn't established both halves — same
   * convention as `ElementHeader`'s `onEdit`.
   */
  reorderCapability?: (CapabilityMapEditContext & { onReordered: () => void }) | undefined;
  /**
   * Sprint U4-2a item 3's "Reorder mode" toggle — controlled from the
   * caller (`CapabilityMapPage.tsx`), same reasoning as `colourBy` just
   * above: this component gets unmounted and remounted by its own parent
   * every time `reorderCapability`'s own `onReordered` triggers a reload
   * (`state.status` cycles through `'loading'` before `'ready'` again,
   * and the parent only renders this component at all while `'ready'`) —
   * local state here would silently reset to `false` after literally
   * every successful move, found live via this session's own e2e run
   * (the spec's second move failed because the toggle it had just turned
   * on was already gone again).
   */
  reorderMode: boolean;
  onReorderModeChange: (mode: boolean) => void;
}

/**
 * The capability map's renderer (UI-principles §6.1, §3.1): nested tiles —
 * L1 as columns, L2 as stacked cards, L3 revealed inline on expand. Plain
 * DOM/CSS, not Canvas — see src/ui/capabilityMap/layout.ts's module
 * comment for why. Colour-by (src/ui/capabilityMap/metrics.ts) is a
 * toolbar toggle — `colourBy`/`onColourByChange` are controlled from the
 * caller (`CapabilityMapPage.tsx`'s `useColourByPreference`, Sprint U4-1
 * C4), not local state here, since its default depends on context
 * (home mode, whether the model has systems yet) and its choice needs to
 * persist across visits, both concerns this component itself shouldn't
 * own. Every mode still shows the supporting-system count as text
 * regardless (§4.3-style "never colour-only").
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
 * clickable L2 cards, not one clickable unit, so a tile-style whole-
 * column click target and fill don't apply the same way — but the
 * human's own review of C3 did ask for a *group-level* signal at L1: a
 * Chip (a strip, not a fill — `aggregateTileColourFor`, metrics.ts)
 * aggregated across every L2 *and* L3 descendant, worst-of-children for
 * exposure/lifecycle stage, fraction-supported for coverage — so a
 * capability exposed only at L3 still shows at its L1 ancestor, and the
 * L1 name link itself just loses its underline (`.columnLink`), the same
 * "plain-text name" reasoning as the tile component's own primary link,
 * without becoming a stretched-link tile itself.
 *
 * Sprint U4-1 C5: "'+ Add capability' moves to the page action area;
 * colour-by stays left as a view control." This component no longer
 * renders `CapabilityMapAddForm` at all — `CapabilityMapPage.tsx`'s own
 * header now owns that action, alongside its title, the same page-level
 * spot `LandscapePage.tsx` already uses for "+ Add system"/"+ Add actor".
 * Colour-by (the `select` in `.toolbar` below) stays exactly where it
 * was: a view control that changes how this view reads, not a page
 * action that changes the model — the same distinction `LandscapePage.tsx`
 * draws between its own header actions and `BranchViewModeControl`.
 *
 * Check B6 (docs/CHECK-U4-2a.md): below 768px, each L1 column collapses
 * to an accordion group — name, tone strip, coverage chip, counts — only
 * one open at a time (`expandedL1` above); its L2 children render as
 * dense rows (`MobileL2Row`) instead of blueprint-framed `CapabilityTile`
 * cards, with L3 revealed by the same tap-to-expand toggle desktop
 * already has. See `L1ColumnView`'s own comment for why this branches on
 * a JS `narrow` flag rather than a CSS media query.
 */
export function CapabilityMapView({ tree, supportsEdges, systemsById, hasSystems, colourBy, onColourByChange, orgSlug, modelSlug, refParam, reorderCapability, reorderMode, onReorderModeChange }: CapabilityMapViewProps) {
  const [expanded, setExpanded] = useState<Set<UUID>>(new Set());
  const colourById = useId();
  const reorderModeId = useId();
  // Check B6: "Mobile (<768px): L1 groups as a collapsed list [...] one
  // expanded at a time; L2 dense rows, no blueprint frame; L3 on tap" —
  // the same JS-driven breakpoint LandscapePage.tsx's own E1 disclosures
  // use (`useIsNarrowViewport`'s own comment explains why this needs to
  // be a real conditional mount, not a CSS-only restyle: L1's header goes
  // from a plain-text Link + row of controls to a single accordion toggle
  // button — those aren't the same markup restyled, they're two different
  // interaction models). `.columns`/`.column` (the grid + its
  // `role="list"`/`role="listitem"` pair Sprint U4-1 C2 added) stay the
  // outer structure at every width — narrow collapses each column's own
  // L2 content behind its header instead of swapping the grid out for a
  // different container, so e2e/capability-map-layout.spec.ts's own
  // "1 column at 390px" / list-role assertions still hold unchanged.
  const narrow = useIsNarrowViewport(768);
  const [expandedL1, setExpandedL1] = useState<UUID | null>(null);

  function toggleExpandedL1(id: UUID): void {
    setExpandedL1((prev) => (prev === id ? null : id));
  }
  // Sprint U4-2a item 3: "reorder controls behind a Reorder mode" — the
  // move buttons used to render inline on every tile whenever the caller
  // had edit rights at all, which meant an owner/architect saw two extra
  // buttons crowding *every* L1 header and L2 card just to browse the map
  // (and directly caused item 3's other complaint, "L1 header on one
  // row" — that's what was pushing the header onto a second line at the
  // narrower desktop breakpoints). Gating on an explicit toggle — off by
  // default — means reordering stays exactly as capable as before but
  // costs nothing when someone's just reading the map, editor or not.
  const activeReorderCapability = reorderMode ? reorderCapability : undefined;

  function toggleExpanded(id: UUID): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Sprint U4-1 C5: no "+ Add capability" fallback here any more —
  // CapabilityMapPage.tsx's own header action area is always visible
  // (whenever `canEdit`), whether the map is empty or not, so there's
  // nothing left for this branch to add beyond the message itself.
  if (tree.l1.length === 0 && tree.orphans.length === 0) {
    return <EmptyState>No capabilities yet. A capability map has nothing to show until at least one Capability element exists.</EmptyState>;
  }

  return (
    <div>
      <div className={styles.toolbar}>
        <label htmlFor={colourById}>
          <Text as="span" size="sm" tone="muted">
            Colour by
          </Text>
        </label>
        <select id={colourById} className={styles.select} value={colourBy} onChange={(e) => { onColourByChange(e.target.value as ColourByMode); }}>
          <option value="none">None</option>
          {COLOUR_BY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {/* Sprint U4-1 C4: "'None' only while the model has no systems, with hint..." — shown for that specific state, not every time someone happens to have colour-by off (a user who manually picks None on a populated model doesn't need a nudge to link systems that are already linked). */}
        {colourBy === 'none' && !hasSystems && (
          <Text as="span" size="sm" tone="muted">
            Link systems to capabilities to see coverage.
          </Text>
        )}
        {/* Sprint U4-2a item 3 — omitted entirely (not shown disabled) when the caller has no edit rights, same convention as `reorderCapability` itself. */}
        {reorderCapability && (
          <span className={styles.reorderModeToggle}>
            <input id={reorderModeId} type="checkbox" checked={reorderMode} onChange={(e) => { onReorderModeChange(e.target.checked); }} />
            <label htmlFor={reorderModeId}>
              <Text as="span" size="sm" tone="muted">
                Reorder mode
              </Text>
            </label>
          </span>
        )}
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
              reorderCapability={activeReorderCapability}
              narrow={narrow}
              l1Expanded={expandedL1 === column.capability.element_id}
              onToggleL1={toggleExpandedL1}
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
  narrow,
  l1Expanded,
  onToggleL1,
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
  /** Check B6: <768px, this column collapses to an accordion group — see `CapabilityMapView`'s own comment for why this is a prop, not a CSS media query. */
  narrow: boolean;
  l1Expanded: boolean;
  onToggleL1: (id: UUID) => void;
}) {
  const panelId = useId();
  const count = supportingSystemIds(column.capability.element_id, supportsEdges).length;
  // Every L2 *and* L3 descendant, *and* the L1 capability itself (Sprint
  // U4-2a item 3: "L1-level supports counted in coverage") — a `supports`
  // edge can land directly on an L1 capability (nothing stops a system
  // supporting a top-level capability with no children of its own yet, or
  // in addition to its descendants), and the group-level Chip above used
  // to only ever look at `column.l2`'s own descendants, silently dropping
  // that edge from the aggregate even though `count`/the zoom link right
  // next to it (both keyed on `column.capability.element_id` directly)
  // already accounted for it correctly.
  const descendantIds = [column.capability.element_id, ...column.l2.flatMap((card) => [card.capability.element_id, ...card.l3.map((leaf) => leaf.element_id)])];
  const aggregateColour = aggregateTileColourFor(colourBy, descendantIds, supportsEdges, systemsById);
  const l2Count = column.l2.length;

  const l2Content = column.l2.map((card, index) =>
    narrow ? (
      <MobileL2Row
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
    ) : (
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
    ),
  );

  if (narrow) {
    // Check B6: a collapsed accordion group — name, tone strip, coverage
    // chip, counts, one expanded at a time (`CapabilityMapView`'s own
    // `expandedL1` state). The header is a single toggle button, not a
    // link plus separate controls: a link and a button can't nest inside
    // each other, and this group's whole point at this width is picking
    // which one to open, not navigating away from the list — "Open →"
    // below, inside the expanded panel, is where direct navigation to
    // the L1 capability's own element page still lives.
    return (
      <div className={styles.column} role="listitem">
        <button
          type="button"
          className={styles.mobileGroupHeader}
          aria-expanded={l1Expanded}
          aria-controls={panelId}
          onClick={() => {
            onToggleL1(column.capability.element_id);
          }}
        >
          <span className={styles.mobileToneStrip} data-tone={aggregateColour.tone ?? 'none'} aria-hidden="true" />
          <span className={styles.mobileGroupHeaderText}>
            <Text as="span" size="lg" className={styles.mobileGroupName}>
              {column.capability.name}
            </Text>
            <span className={styles.mobileGroupMeta}>
              {aggregateColour.tone !== undefined && aggregateColour.label !== undefined && <Chip tone={aggregateColour.tone}>{aggregateColour.label}</Chip>}
              <Text as="span" size="sm" tone="muted">
                {l2Count} capabilit{l2Count === 1 ? 'y' : 'ies'} · {count} system{count === 1 ? '' : 's'}
              </Text>
            </span>
          </span>
          <span className={styles.mobileChevron} aria-hidden="true">
            {l1Expanded ? '▾' : '▸'}
          </span>
        </button>
        {l1Expanded && (
          <div id={panelId} className={styles.mobileGroupBody}>
            <div className={styles.mobileGroupPrimaryRow}>
              <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${column.capability.element_id}`} className={styles.mobileRowLink}>
                <Text as="span" size="sm">
                  Open {column.capability.name} →
                </Text>
              </Link>
              <LandscapeZoomLink capabilityId={column.capability.element_id} count={count} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} />
              {reorderCapability && (
                <ReorderButtons
                  capability={column.capability}
                  previous={previousSibling}
                  next={nextSibling}
                  context={reorderCapability}
                  previousGlyph="↑"
                  previousLabel={`Move ${column.capability.name} up`}
                  nextGlyph="↓"
                  nextLabel={`Move ${column.capability.name} down`}
                />
              )}
            </div>
            {l2Content}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.column} role="listitem">
      <div className={styles.columnHeader}>
        <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${column.capability.element_id}`} className={styles.columnLink}>
          <Text as="span" size="lg">
            {column.capability.name}
          </Text>
        </Link>
        {aggregateColour.tone !== undefined && aggregateColour.label !== undefined && <Chip tone={aggregateColour.tone}>{aggregateColour.label}</Chip>}
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
      {l2Content}
    </div>
  );
}

/**
 * Check B6's "L2 dense rows, no blueprint frame; L3 on tap": the mobile
 * counterpart to `L2CardView` — a plain row (name, tone chip, secondary
 * controls) instead of a `CapabilityTile`, and its L3 children (when
 * expanded via the same `expanded` Set/`onToggleExpand` desktop's L2→L3
 * toggle already uses) render as further dense rows rather than compact
 * tiles. Kept as its own component, not a `dense` prop on `L2CardView`,
 * since the two render genuinely different markup (a `CapabilityTile`
 * wrapper vs. a plain `div`), the same reasoning `L1ColumnView`'s own
 * narrow/wide split uses.
 */
function MobileL2Row({
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
    <div className={styles.mobileL2Row} data-tone={colour.tone ?? 'none'}>
      <div className={styles.mobileRowMain}>
        <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${card.capability.element_id}`} className={styles.mobileRowLink}>
          <Text as="span" size="md">
            {card.capability.name}
          </Text>
        </Link>
        {colour.tone !== undefined && colour.label !== undefined && <Chip tone={colour.tone}>{colour.label}</Chip>}
      </div>
      <div className={styles.mobileRowSecondary}>
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
          // Check B6: "L3 on tap" — the same expand toggle desktop's dense-
          // frame tile already has (`.expandButton`, unchanged), just on a
          // plain row instead of a blueprint-framed card.
          <button type="button" className={styles.expandButton} aria-expanded={expanded} onClick={() => { onToggleExpand(card.capability.element_id); }}>
            {expanded ? '▾' : '▸'} {card.l3.length}
          </button>
        )}
      </div>
      {expanded && card.l3.length > 0 && (
        <div className={styles.mobileL3List}>
          {card.l3.map((leaf) => {
            const leafColour = tileColourFor(colourBy, leaf.element_id, supportsEdges, systemsById);
            const leafCount = supportingSystemIds(leaf.element_id, supportsEdges).length;
            return (
              <div key={leaf.element_id} className={styles.mobileL3Row} data-tone={leafColour.tone ?? 'none'}>
                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${leaf.element_id}`} className={styles.mobileRowLink}>
                  <Text as="span" size="sm">
                    {leaf.name}
                  </Text>
                </Link>
                {leafColour.tone !== undefined && leafColour.label !== undefined && <Chip tone={leafColour.tone}>{leafColour.label}</Chip>}
                <LandscapeZoomLink capabilityId={leaf.element_id} count={leafCount} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} />
              </div>
            );
          })}
        </div>
      )}
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
