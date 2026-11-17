import { createContext, useContext, useId } from 'react';
import { Info } from 'lucide-react';
import { Link } from 'react-router';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { BranchRow } from '../../db/types';
import type { ThreadCount } from '../comments/useThreadCounts';
import { CommentMarkerButton } from '../components/CommentMarkerButton/CommentMarkerButton';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { computeCapabilityRollup } from './capabilityRollup';
import { domainCoverageSegments, domainCoverageSummary, domainSystemsCountText } from './domainSummary';
import { aggregateTileColourFor, supportingSystemIds, tileColourFor, type ColourByMode } from './metrics';
import { ReorderButtons } from '../components/ReorderButtons/ReorderButtons';
import type { CapabilityMapTree, L1Column, L2Card } from './layout';
import styles from './CapabilityMapView.module.css';

/** M1 close-out item 2's own marker shape, derived once per row from the caller's raw `{ open, total }` — `undefined` (no marker at all) for a capability with no comment thread. */
function commentMarkerFor(threadCounts: ReadonlyMap<UUID, ThreadCount> | undefined, capabilityId: UUID): { state: 'ink'; count: number } | { state: 'hollow' } | undefined {
  const counts = threadCounts?.get(capabilityId);
  if (!counts || counts.total === 0) return undefined;
  return counts.open > 0 ? { state: 'ink', count: counts.open } : { state: 'hollow' };
}

/**
 * `reorderCapability`'s own "does the caller have edit rights, and what do
 * we need to commit through them" shape (Sprint U4-1 C1). Also used to be
 * `addCapability`'s shape too, before Sprint U4-1 C5 moved "+ Add
 * capability" out of this component entirely, into `CapabilityMapPage.tsx`'s
 * own page-action area — reordering stays a per-row control rendered
 * inside the map itself, not a page action, so it's the one caller left.
 */
export interface CapabilityMapEditContext {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
}

/** For a future "as at" date: the capabilities whose supporting systems differ from today. Empty (the default) marks nothing. */
const NO_CHANGES: ReadonlySet<UUID> = new Set();
const ChangedByDateContext = createContext<ReadonlySet<UUID>>(NO_CHANGES);
/** ADR-035: the capabilities serving the goal picked in "Show goal"; `null` (the default) means no goal is picked and nothing is dimmed. */
const GoalFocusContext = createContext<ReadonlySet<UUID> | null>(null);

export interface CapabilityMapViewProps {
  /** The capabilities serving the goal picked in "Show goal": they stay at full strength and say so, the rest fade. Omit (or `null`) to show the map as usual. */
  goalCapabilityIds?: ReadonlySet<UUID> | null | undefined;
  /** Capabilities to mark "Changes by this date" (a future date's difference from today). Omit to mark nothing. */
  changedCapabilityIds?: ReadonlySet<UUID> | undefined;
  tree: CapabilityMapTree;
  supportsEdges: RelationshipsHeadRow[];
  replacedIds: ReadonlySet<UUID>;
  /** F6 Step 6: every live `enables` edge at this ref — "enables N stages" beside a domain/card's own supporting-system count (silent at zero, rule 7). */
  enablesEdges: RelationshipsHeadRow[];
  systemsById: Map<UUID, ElementsHeadRow>;
  /** Capability rollup: every capability at this ref, every level — the input `capabilityRollup.ts`'s subtree walk needs; `tree` is the same set already nested, kept flat here too since a tree shape isn't what that walk wants. */
  capabilities: ElementsHeadRow[];
  /** Capability rollup's owner-coverage input — `src/db/healthFindings.ts`'s `computeSelfOwnedCapabilityIds` result, computed once by the caller. */
  selfOwnedIds: ReadonlySet<UUID>;
  /**
   * Resolved and persisted by the caller (`useColourByPreference`) — this
   * component only reads it to pick each row's own thin tone indicator.
   * The `<select>` control itself (and the "link systems" hint,
   * `hasSystems`) lives in the shared Inspector's own Filters section
   * (`CapabilityMapInspectorContent.tsx`, owned by `CapabilityMapPage.tsx`)
   * — this component no longer renders a toolbar or takes an
   * `onColourByChange`/`hasSystems` prop of its own.
   */
  colourBy: ColourByMode;
  orgSlug: string;
  modelSlug: string;
  /**
   * The full `ref=...` query fragment (S1 item 2: `refQueryParam`, so it
   * also carries `&viewing=1` while this page itself is a read-only
   * viewing ref — a change viewed via "View this change" must stay
   * read-only through this link too, not silently become the session's
   * editing ref the moment `LandscapePage` sees a bare `?ref=branch:x`
   * with no `viewing` flag) — carried into every "→ Landscape" zoom link
   * so it lands on the same ref the map itself is showing (§2.4's
   * deep-link rule). Despite the name, this is the whole fragment, not a
   * bare token — the one place it's actually consumed, `LandscapeZoomLink`
   * below, appends `&capability=` directly rather than rebuilding it via
   * `URLSearchParams` (which would double-encode the `&` if a viewing
   * flag were smuggled into a single param value instead).
   */
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
   * every time `reorderCapability`'s own `onReordered` triggers a reload —
   * local state here would silently reset to `false` after literally
   * every successful move.
   */
  reorderMode: boolean;
  /**
   * Density pass (capability map redesign): which one domain (L1
   * capability), if any, is expanded — the same single-open-at-a-time
   * accordion shape this view's own pre-redesign mobile treatment already
   * used (`expandedL1`), now the only interaction model at every width,
   * not a mobile-only fallback. Lifted to the caller for the same "this
   * component gets unmounted/remounted on every mutation-triggered
   * reload" reason `reorderMode`/`expanded` below already are. `null`
   * (collapsed) by default — `CapabilityMapPage.tsx` seeds it from
   * `?domain=` on first load.
   */
  expandedDomainId: UUID | null;
  onToggleDomain: (id: UUID) => void;
  /**
   * Which L2 cards have their L3 children expanded — lifted to the caller
   * for the same reload/remount reason as `expandedDomains` above.
   */
  expanded: ReadonlySet<UUID>;
  onToggleExpand: (id: UUID) => void;
  /** M1 close-out item 2: "markers on tiles (bottom-right, same rule)" — the caller's own `useThreadCounts` result, keyed by capability id. `undefined` while still loading, same convention `unresolvedCount`/`unresolvedCommentCounts` already use elsewhere; a row with no entry (or `total === 0`) shows no marker at all. */
  threadCounts?: ReadonlyMap<UUID, ThreadCount> | undefined;
  /** Opens the comments panel scoped to the clicked capability — omitted entirely (same convention as `reorderCapability`) wherever the caller hasn't wired a panel at all. */
  onCommentMarkerClick?: ((capabilityId: UUID) => void) | undefined;
  /** Opens the shared Inspector panel scoped to the clicked capability, at every level (domain header, L2 row, L3 row) — same omitted-entirely convention as `onCommentMarkerClick`. */
  onInspectClick?: ((capabilityId: UUID) => void) | undefined;
}

/**
 * The capability map's renderer (UI-principles §6.1, §3.1): nested
 * capabilities — L1 as collapsible domain rows, L2/L3 as compact cards
 * revealed only once their domain is expanded. Plain DOM/CSS, not Canvas —
 * see src/ui/capabilityMap/layout.ts's module comment for why.
 *
 * **Capability map redesign (density pass)**: this view is the structural
 * reference — what capabilities exist, how they group into domains, what
 * systems support each one — never a findings surface. Home (Director/
 * Architect) already owns "where are we weak": severity coloring, reason
 * pills, "start a decision" actions, a findings dataset. This view states
 * a fact in neutral text when a capability has no supporting system or no
 * recorded owner — never amber alarm styling, never a judgment, and never
 * its own recomputed version of what's wrong (that would drift from
 * Home's own findings over time). Concretely: no filled tone backgrounds,
 * no Chip pills, no dot-joined meta strings — a thin line/dot indicator
 * paired with plain text, in its own visual zone, everywhere a fact needs
 * showing. `colourBy` (`metrics.ts`) still selects which fact a row's own
 * indicator carries (unchanged as a feature — only how it's drawn changed:
 * a thin left-border + plain label text, never a filled tile or a pill).
 *
 * Domains (`DomainSection` below) are collapsed by default and stay a
 * single summary row — chevron, name, a plain coverage sentence paired
 * with its own segmented mini-bar (`domainSummary.ts`'s
 * `domainCoverageSegments`, one segment per subtree capability,
 * informational only), the domain's own supporting-system count, and an
 * owner note when it lacks one — each its own visual zone, read in that
 * order — until expanded,
 * at which point its own L2 cards (`CapabilityRow`) render in a
 * responsive grid, each a single compact row: name, a thin left-border
 * indicator, the supporting-system count. L3 (an L2's own children, when
 * it has any) reveal via the same expand toggle this app already used
 * pre-redesign (`expanded`/`onToggleExpand`, unchanged), as further
 * `CapabilityRow`s one level indented — this redesign only ever changes
 * how a domain and a card are *drawn*, never the three-level structure
 * itself or any of its existing links (owner display, the "→ Landscape"
 * supporting-system drill-through, reorder, comments, Inspector).
 *
 * Playwright coverage: e2e/capability-map*.engine.spec.ts.
 */
export function CapabilityMapView({
  tree,
  supportsEdges,
  replacedIds,
  enablesEdges,
  systemsById,
  capabilities,
  selfOwnedIds,
  colourBy,
  orgSlug,
  modelSlug,
  refParam,
  reorderCapability,
  reorderMode,
  expandedDomainId,
  onToggleDomain,
  expanded,
  onToggleExpand,
  threadCounts,
  onCommentMarkerClick,
  onInspectClick,
  changedCapabilityIds,
  goalCapabilityIds,
}: CapabilityMapViewProps) {
  // Sprint U4-2a item 3: "reorder controls behind a Reorder mode" — the
  // move buttons used to render inline on every row whenever the caller
  // had edit rights at all, which meant an owner/architect saw two extra
  // buttons crowding every row just to browse the map. Gating on an
  // explicit toggle — off by default — means reordering stays exactly as
  // capable as before but costs nothing when someone's just reading.
  const activeReorderCapability = reorderMode ? reorderCapability : undefined;

  // Sprint U4-1 C5: no "+ Add capability" fallback here any more —
  // CapabilityMapPage.tsx's own header action area is always visible
  // (whenever `canEdit`), whether the map is empty or not, so there's
  // nothing left for this branch to add beyond the message itself.
  if (tree.l1.length === 0 && tree.orphans.length === 0) {
    return <EmptyState>No capabilities yet. A capability map has nothing to show until at least one Capability element exists.</EmptyState>;
  }

  // Capability rollup's own ancestor-walk input (`isCapabilityOwnedWithAncestry`) — built once per render rather than inside each domain.
  const capabilitiesById = new Map(capabilities.map((c) => [c.element_id, c]));
  // F6 Step 6: how many stages each capability enables (`enables` edges' own `from_element_id`), counted once for every domain/card rather than re-walking `enablesEdges` per row.
  const enablesCountById = new Map<UUID, number>();
  for (const edge of enablesEdges) enablesCountById.set(edge.from_element_id, (enablesCountById.get(edge.from_element_id) ?? 0) + 1);

  return (
    <ChangedByDateContext.Provider value={changedCapabilityIds ?? NO_CHANGES}>
    <GoalFocusContext.Provider value={goalCapabilityIds ?? null}>
    <div>
      {tree.l1.length > 0 && (
        <div className={styles.domains} role="list" aria-label="Capability domains">
          {tree.l1.map((column, index) => (
            <DomainSection
              key={column.capability.element_id}
              column={column}
              colourBy={colourBy}
              supportsEdges={supportsEdges}
              replacedIds={replacedIds}
              systemsById={systemsById}
              capabilities={capabilities}
              capabilitiesById={capabilitiesById}
              selfOwnedIds={selfOwnedIds}
              orgSlug={orgSlug}
              modelSlug={modelSlug}
              refParam={refParam}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              previousSibling={tree.l1[index - 1]?.capability}
              nextSibling={tree.l1[index + 1]?.capability}
              siblings={tree.l1.map((c) => c.capability)}
              reorderCapability={activeReorderCapability}
              domainExpanded={expandedDomainId === column.capability.element_id}
              onToggleDomain={onToggleDomain}
              threadCounts={threadCounts}
              onCommentMarkerClick={onCommentMarkerClick}
              onInspectClick={onInspectClick}
              enablesCountById={enablesCountById}
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
    </GoalFocusContext.Provider>
    </ChangedByDateContext.Provider>
  );
}

/**
 * The "→ Landscape" zoom link every row shows next to its supporting-
 * system count. A row with zero supporting systems shows a muted "no
 * systems" line instead (nowhere to zoom to, so no link) — informational,
 * not a problem, the same "plain, not hidden" stance CLAUDE.md rule 7
 * takes everywhere else a count can legitimately be zero.
 */
export function LandscapeZoomLink({ capabilityId, count, orgSlug, modelSlug, refParam }: { capabilityId: UUID; count: number; orgSlug: string; modelSlug: string; refParam: string }) {
  if (count === 0) {
    // A gap is a flag, so it links straight to where it is fixed: the capability's own page, where a supporting system is added.
    return (
      <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${capabilityId}`} className={styles.zoomLink}>
        <Text as="span" tone="faint" size="sm">
          no systems — add one →
        </Text>
      </Link>
    );
  }
  const href = `/o/${orgSlug}/m/${modelSlug}/landscape?${refParam}&capability=${capabilityId}`;
  return (
    <Link to={href} className={styles.zoomLink}>
      <Text as="span" tone="faint" size="sm">
        {count} system{count === 1 ? '' : 's'} →
      </Text>
    </Link>
  );
}

/** F6 Step 6: "enables N stages" — a quiet fact next to a capability's own supporting-system count, silent at zero (rule 7: an absent fact is shown absent). */
function EnablesStagesCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Text as="span" size="sm" tone="muted">
      enables {count} stage{count === 1 ? '' : 's'}
    </Text>
  );
}

/**
 * A row's own way into the shared Inspector — a small icon-only button,
 * reused identically at domain, L2 and L3 level (none of them are a
 * `BlueprintFrame`-style tile with a frame of its own to pin a corner
 * button to any more, post-redesign, so every level shares this one plain
 * inline control instead of a per-tile corner overlay).
 */
function InspectButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.inspectButton} aria-label={`Inspect ${name}`} title="Show details" onClick={onClick}>
      <Info size={14} aria-hidden="true" />
      <span>Details</span>
    </button>
  );
}

/**
 * One quiet fact-with-text zone — the shared shape every informational
 * indicator in this redesigned view uses (a domain's coverage/colour-by
 * state, a row's own colour-by tone, "no owner"): a small dot or line in
 * `tone`'s own colour, `--text-faint`/`--border` when there's no tone at
 * all, next to its own plain-text label. Never a filled background, never
 * a border, never a pill — the one formula CLAUDE.md rule 2/this
 * redesign's own role boundary asks every "fact, not a flag" surface here
 * to share, so a reviewer only has to check it's used correctly once.
 */
function FactIndicator({ tone, label, amount }: { tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | undefined; label: string; amount?: number | undefined }) {
  return (
    <span className={styles.factIndicator}>
      <span className={styles.factDot} data-tone={tone ?? 'none'} data-amount={amount} aria-hidden="true" />
      <Text as="span" size="sm" tone="muted">
        {label}
      </Text>
    </span>
  );
}

/**
 * A collapsed domain's own mini-bar (redesign item 2): one small segment
 * per subtree capability (`domainSummary.ts`'s `domainCoverageSegments`),
 * quiet green/amber by whether that capability has a supporting system —
 * informational, never a severity indicator, and always paired with the
 * plain coverage sentence beside it (never colour-only).
 */
function CoverageMiniBar({ segments }: { segments: readonly { capabilityId: UUID; hasSupport: boolean }[] }) {
  if (segments.length === 0) return null;
  return (
    <span className={styles.miniBar} role="img" aria-label={`${String(segments.filter((s) => s.hasSupport).length)} of ${String(segments.length)} covered`}>
      {segments.map((segment, index) => (
        // A capability id can repeat across a subtree walk in principle — position is what the bar itself renders in order, not identity.
        <span key={`${segment.capabilityId}-${String(index)}`} className={styles.miniBarSegment} data-covered={segment.hasSupport} />
      ))}
    </span>
  );
}

function DomainSection({
  column,
  colourBy,
  supportsEdges,
  replacedIds,
  systemsById,
  capabilities,
  capabilitiesById,
  selfOwnedIds,
  orgSlug,
  modelSlug,
  refParam,
  expanded,
  onToggleExpand,
  previousSibling,
  nextSibling,
  siblings,
  reorderCapability,
  domainExpanded,
  onToggleDomain,
  threadCounts,
  onCommentMarkerClick,
  onInspectClick,
  enablesCountById,
}: {
  column: L1Column;
  colourBy: ColourByMode;
  supportsEdges: RelationshipsHeadRow[];
  replacedIds: ReadonlySet<UUID>;
  systemsById: Map<UUID, ElementsHeadRow>;
  capabilities: ElementsHeadRow[];
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>;
  selfOwnedIds: ReadonlySet<UUID>;
  orgSlug: string;
  modelSlug: string;
  refParam: string;
  expanded: ReadonlySet<UUID>;
  onToggleExpand: (id: UUID) => void;
  previousSibling: ElementsHeadRow | undefined;
  nextSibling: ElementsHeadRow | undefined;
  /** S1 item 13: every L1 capability, in display order — `ReorderButtons`' own `siblings` prop comment. */
  siblings: readonly ElementsHeadRow[];
  reorderCapability: (CapabilityMapEditContext & { onReordered: () => void }) | undefined;
  domainExpanded: boolean;
  onToggleDomain: (id: UUID) => void;
  threadCounts: ReadonlyMap<UUID, ThreadCount> | undefined;
  onCommentMarkerClick: ((capabilityId: UUID) => void) | undefined;
  onInspectClick: ((capabilityId: UUID) => void) | undefined;
  enablesCountById: ReadonlyMap<UUID, number>;
}) {
  const panelId = useId();
  // Capability rollup (Sprint U4-2, "capability rollup", decided): a
  // domain's own system count and "N of M have a supporting system"
  // sentence are always a rollup over its subtree (itself plus every
  // L2/L3 descendant), deduped by system.
  const rollup = computeCapabilityRollup(column.capability, capabilities, capabilitiesById, supportsEdges, selfOwnedIds);
  const count = rollup.supportingSystemIds.length;
  const aggregateColour = aggregateTileColourFor(colourBy, rollup.subtreeCapabilityIds, supportsEdges, systemsById, replacedIds);
  const segments = domainCoverageSegments(rollup.subtreeCapabilityIds, rollup.subtreeSupportsEdges);
  const goalFocus = useContext(GoalFocusContext);
  const servingGoal = goalFocus === null ? 0 : rollup.subtreeCapabilityIds.filter((id) => goalFocus.has(id)).length;

  return (
    <div className={styles.domain} role="listitem" data-goal={goalFocus === null ? undefined : servingGoal > 0 ? 'match' : 'other'}>
      {/*
       * Redesign item 1/2: collapsed by default, a single row — chevron,
       * name, a plain coverage sentence, a segmented mini-bar — each its
       * own visual zone (never one dot-joined string). A real `<button>`,
       * whole row the click target, `aria-expanded` reflecting state —
       * the same accordion shape this view's own mobile treatment already
       * used pre-redesign, now the *only* domain header at every width
       * (no more separate desktop-always-open layout).
       */}
      <button
        type="button"
        className={styles.domainHeader}
        aria-expanded={domainExpanded}
        aria-controls={panelId}
        onClick={() => {
          onToggleDomain(column.capability.element_id);
        }}
      >
        <span className={styles.domainChevron} aria-hidden="true">
          {domainExpanded ? '▾' : '▸'}
        </span>
        <span className={styles.domainName} title={column.capability.name}>
          <Text as="span" size="lg">
            {column.capability.name}
          </Text>
        </span>
        {/*
         * Bug fix (findings-from-use follow-up, item 1/4): the fraction and
         * its mini-bar are one visual zone, read together — the bar used to
         * sit far to the right, separated from the fraction it illustrates
         * by whatever space `.domainName`'s old flex-grow left behind.
         */}
        <span className={styles.domainCoverage}>
          <Text as="span" size="sm" tone="muted" className={styles.domainSummaryText}>
            {domainCoverageSummary(rollup.supportedCapabilityCount, rollup.totalCapabilityCount)}
          </Text>
          <CoverageMiniBar segments={segments} />
        </span>
        {/* Bug fix, item 1: this used to be `aggregateColour`'s own coverage-mode label ("capabilities supported"/"no capabilities supported") — a fixed phrase restating the fraction's zero/non-zero state, not a value of its own. The domain's real supporting-system count belongs here instead. */}
        <Text as="span" size="sm" tone="muted" className={styles.domainSystemsCount}>
          {domainSystemsCountText(count)}
        </Text>
        {/* Coverage mode's own aggregate label is always this same "capabilities supported"/"no capabilities supported" non-value — already fully covered by the fraction/mini-bar/count above, so it's never shown for that one mode; every other colour-by mode's label is a real, distinct fact (a lifecycle stage, "exposed", a criticality level, an OT-share fraction, a fit rating) and still shows here. */}
        {colourBy !== 'metric:supportingSystemCount' && (aggregateColour.tone !== undefined || aggregateColour.amount !== undefined) && aggregateColour.label !== undefined && <FactIndicator tone={aggregateColour.tone} amount={aggregateColour.amount} label={aggregateColour.label} />}
        {!rollup.isOwned && <FactIndicator tone="warn" label="no owner recorded" />}
        {servingGoal > 0 && (
          <Text as="span" size="sm" className={styles.goalMark}>
            {servingGoal === 1 ? '1 serves this goal' : `${String(servingGoal)} serve this goal`}
          </Text>
        )}
      </button>
      {domainExpanded && (
        <div id={panelId} className={styles.domainBody}>
          <div className={styles.domainActions}>
            <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${column.capability.element_id}`} className={styles.domainOpenLink}>
              <Text as="span" size="sm">
                Open {column.capability.name} →
              </Text>
            </Link>
            <LandscapeZoomLink capabilityId={column.capability.element_id} count={count} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} />
            <EnablesStagesCount count={enablesCountById.get(column.capability.element_id) ?? 0} />
            {!rollup.isOwned && (
              <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${column.capability.element_id}`} className={styles.zoomLink}>
                <Text as="span" size="sm" tone="muted">
                  no owner recorded — add one →
                </Text>
              </Link>
            )}
            {onInspectClick && <InspectButton name={column.capability.name} onClick={() => { onInspectClick(column.capability.element_id); }} />}
            {reorderCapability && <ReorderButtons elementType="capability" element={column.capability} previous={previousSibling} next={nextSibling} siblings={siblings} context={reorderCapability} />}
          </div>
          <div className={styles.cardGrid} role="list" aria-label={`${column.capability.name} capabilities`}>
            {column.l2.map((card, index) => (
              <CapabilityRow
                key={card.capability.element_id}
                card={card}
                colourBy={colourBy}
                supportsEdges={supportsEdges}
                replacedIds={replacedIds}
                systemsById={systemsById}
                orgSlug={orgSlug}
                modelSlug={modelSlug}
                refParam={refParam}
                expanded={expanded.has(card.capability.element_id)}
                onToggleExpand={onToggleExpand}
                previousSibling={column.l2[index - 1]?.capability}
                nextSibling={column.l2[index + 1]?.capability}
                siblings={column.l2.map((c) => c.capability)}
                reorderCapability={reorderCapability}
                threadCounts={threadCounts}
                onCommentMarkerClick={onCommentMarkerClick}
                onInspectClick={onInspectClick}
                enablesCountById={enablesCountById}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Redesign item 3: a compact capability card, one level of L3 nesting
 * supported — name, a thin left-border indicator (`colourBy`'s own tone),
 * the supporting-system count on the right. Replaces the pre-redesign
 * split between a desktop `CapabilityTile` (blueprint-framed, tone-filled,
 * a Chip pill) and a mobile-only dense row — one shape at every width now,
 * since the redesign's own coloring rule (thin line/dot + plain text,
 * never a fill or a pill) never wanted the tile's filled treatment to
 * begin with.
 *
 * No per-card "no owner recorded" note (bug-fix follow-up, item 5):
 * ownership here is `isCapabilityOwnedWithAncestry`'s own 2-level ancestor
 * walk (self, parent, grandparent), so a card can only ever read as
 * *unowned* when its owning L1 domain is unowned too — the domain header's
 * own "no owner recorded" (`DomainSection`, driven by `rollup.isOwned`,
 * the same predicate applied to the L1 itself) is therefore never less
 * informative than repeating the identical fact on every card beneath it,
 * and a card that *is* owned already renders no owner note at all. This
 * isn't a threshold or a "mostly" case — it's true every time, so the
 * per-card note is dropped rather than conditionally suppressed.
 */
function CapabilityRow({
  card,
  colourBy,
  supportsEdges,
  replacedIds,
  systemsById,
  orgSlug,
  modelSlug,
  refParam,
  expanded,
  onToggleExpand,
  previousSibling,
  nextSibling,
  siblings,
  reorderCapability,
  threadCounts,
  onCommentMarkerClick,
  onInspectClick,
  enablesCountById,
  nested = false,
}: {
  card: L2Card;
  colourBy: ColourByMode;
  supportsEdges: RelationshipsHeadRow[];
  replacedIds: ReadonlySet<UUID>;
  systemsById: Map<UUID, ElementsHeadRow>;
  orgSlug: string;
  modelSlug: string;
  refParam: string;
  expanded: boolean;
  onToggleExpand: (id: UUID) => void;
  previousSibling: ElementsHeadRow | undefined;
  nextSibling: ElementsHeadRow | undefined;
  /** S1 item 13: every sibling under the same parent, in display order — `ReorderButtons`' own `siblings` prop comment. */
  siblings: readonly ElementsHeadRow[];
  reorderCapability: (CapabilityMapEditContext & { onReordered: () => void }) | undefined;
  threadCounts: ReadonlyMap<UUID, ThreadCount> | undefined;
  onCommentMarkerClick: ((capabilityId: UUID) => void) | undefined;
  onInspectClick: ((capabilityId: UUID) => void) | undefined;
  enablesCountById: ReadonlyMap<UUID, number>;
  /** `true` for an L3 row rendered inside its own L2 parent's expanded list — indented, no expand toggle of its own (L3 has no further children). */
  nested?: boolean;
}) {
  const colour = tileColourFor(colourBy, card.capability.element_id, supportsEdges, systemsById, replacedIds);
  const count = supportingSystemIds(card.capability.element_id, supportsEdges).length;
  const marker = commentMarkerFor(threadCounts, card.capability.element_id);
  const changesByDate = useContext(ChangedByDateContext).has(card.capability.element_id);
  const goalFocus = useContext(GoalFocusContext);
  const servesGoal = goalFocus?.has(card.capability.element_id) === true;

  return (
    <div className={[styles.card, nested ? styles.cardNested : ''].filter(Boolean).join(' ')} data-tone={colour.tone ?? 'none'} data-amount={colour.amount} data-changes={changesByDate ? 'true' : undefined} data-goal={goalFocus === null ? undefined : servesGoal ? 'match' : 'other'} role={nested ? undefined : 'listitem'}>
      <div className={styles.cardMain}>
        <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${card.capability.element_id}`} className={styles.cardLink} title={card.capability.name}>
          <Text as="span" size="md" className={styles.cardName}>
            {card.capability.name}
          </Text>
        </Link>
        <LandscapeZoomLink capabilityId={card.capability.element_id} count={count} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} />
        <EnablesStagesCount count={enablesCountById.get(card.capability.element_id) ?? 0} />
      </div>
      {servesGoal && (
        <Text as="span" size="sm" className={styles.goalMark}>
          Serves this goal
        </Text>
      )}
      {changesByDate && (
        <Text as="span" size="sm" tone="muted" className={styles.changesMark}>
          Changes by this date
        </Text>
      )}
      <div className={styles.cardSecondary}>
        {/* Coverage mode's own label is always the same "supporting systems"/"no supporting systems" non-value — the real count already sits beside the name above (`LandscapeZoomLink`), so it's never shown for that one mode; every other colour-by mode's label is a real, distinct fact and still shows here. */}
        {colourBy !== 'metric:supportingSystemCount' && (colour.tone !== undefined || colour.amount !== undefined) && colour.label !== undefined && <FactIndicator tone={colour.tone} amount={colour.amount} label={colour.label} />}
        {marker && onCommentMarkerClick && <CommentMarkerButton marker={marker} onClick={() => { onCommentMarkerClick(card.capability.element_id); }} />}
        {!nested && card.l3.length > 0 && (
          <button type="button" className={styles.expandButton} aria-expanded={expanded} onClick={() => { onToggleExpand(card.capability.element_id); }}>
            {expanded ? '▾' : '▸'} {card.l3.length}
          </button>
        )}
        {onInspectClick && <InspectButton name={card.capability.name} onClick={() => { onInspectClick(card.capability.element_id); }} />}
        {reorderCapability && <ReorderButtons elementType="capability" element={card.capability} previous={previousSibling} next={nextSibling} siblings={siblings} context={reorderCapability} />}
      </div>
      {!nested && expanded && card.l3.length > 0 && (
        <div className={styles.l3List}>
          {card.l3.map((leaf, index) => (
            <CapabilityRow
              key={leaf.element_id}
              card={{ capability: leaf, l3: [] }}
              colourBy={colourBy}
              supportsEdges={supportsEdges}
              replacedIds={replacedIds}
              systemsById={systemsById}
              orgSlug={orgSlug}
              modelSlug={modelSlug}
              refParam={refParam}
              expanded={false}
              onToggleExpand={onToggleExpand}
              previousSibling={card.l3[index - 1]}
              nextSibling={card.l3[index + 1]}
              siblings={card.l3}
              reorderCapability={reorderCapability}
              threadCounts={threadCounts}
              onCommentMarkerClick={onCommentMarkerClick}
              onInspectClick={onInspectClick}
              enablesCountById={enablesCountById}
              nested
            />
          ))}
        </div>
      )}
    </div>
  );
}
