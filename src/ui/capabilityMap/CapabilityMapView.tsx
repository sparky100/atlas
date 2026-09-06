import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { CapabilityMapAddForm } from './CapabilityMapAddForm';
import { COLOUR_BY_OPTIONS, supportingSystemIds, tileColourFor, type ColourByMode } from './metrics';
import type { CapabilityMapTree, L1Column, L2Card } from './layout';
import styles from './CapabilityMapView.module.css';

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
  addCapability?: { modelId: UUID; orgId: UUID; userId: UUID | null; expectedHeadCommitId: UUID; onCreated: () => void } | undefined;
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
 */
export function CapabilityMapView({ tree, supportsEdges, systemsById, orgSlug, modelSlug, refParam, addCapability }: CapabilityMapViewProps) {
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
        <div className={styles.columns}>
          {tree.l1.map((column) => (
            <L1ColumnView key={column.capability.element_id} column={column} colourBy={colourBy} supportsEdges={supportsEdges} systemsById={systemsById} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} expanded={expanded} onToggleExpand={toggleExpanded} />
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
}) {
  const count = supportingSystemIds(column.capability.element_id, supportsEdges).length;
  return (
    <div className={styles.column}>
      <div className={styles.columnHeader}>
        <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${column.capability.element_id}`}>
          <Text as="span" size="lg">
            {column.capability.name}
          </Text>
        </Link>
        <LandscapeZoomLink capabilityId={column.capability.element_id} count={count} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} />
      </div>
      {column.l2.map((card) => (
        <L2CardView key={card.capability.element_id} card={card} colourBy={colourBy} supportsEdges={supportsEdges} systemsById={systemsById} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} expanded={expanded.has(card.capability.element_id)} onToggleExpand={onToggleExpand} />
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
}) {
  const colour = tileColourFor(colourBy, card.capability.element_id, supportsEdges, systemsById);
  const count = supportingSystemIds(card.capability.element_id, supportsEdges).length;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${card.capability.element_id}`}>
            <Text as="span">{card.capability.name}</Text>
          </Link>
          <LandscapeZoomLink capabilityId={card.capability.element_id} count={count} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} />
          {colour.tone !== undefined && colour.label !== undefined && <Chip tone={colour.tone}>{colour.label}</Chip>}
        </div>
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
              <div key={leaf.element_id} className={styles.l3Tile}>
                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${leaf.element_id}`}>
                  <Text as="span" size="sm">
                    {leaf.name}
                  </Text>
                </Link>
                <LandscapeZoomLink capabilityId={leaf.element_id} count={leafCount} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} />
                {leafColour.tone !== undefined && leafColour.label !== undefined && <Chip tone={leafColour.tone}>{leafColour.label}</Chip>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
