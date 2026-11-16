import { SlidersHorizontal } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Text } from '../components/Text/Text';
import { CRITICALITY_TONE } from '../elements/criticalityTone';
import { fitForPurposeToneFor } from '../elements/fitForPurposeTone';
import { LIFECYCLE_TONE } from '../elements/lifecycleTone';
import { ownersByRole } from '../elements/ownersByRole';
import { capabilityMapInspectorSupportingSystems } from './capabilityMapInspectorSelection';
import { LandscapeZoomLink } from './CapabilityMapView';
import { agentShareOf, COLOUR_BY_OPTIONS, oldestLifecycleStage, otShareOf, worstCriticality, worstFitForPurpose, type ColourByMode } from './metrics';
import { AI_AUTONOMY_TONE } from '../elements/aiAutonomyTone';
import { aiAutonomyLabel } from '../../engine/elementRead/aiAgent';
import styles from './CapabilityMapInspectorContent.module.css';

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * V2b's Inspector, Capability map's own content. Unlike Landscape (an
 * existing focus/filter panel to replace), this view had no side panel or
 * "selected tile" concept at all before — the decision (asked, since
 * every tile was previously a full-page stretched link with no
 * non-navigating precedent besides the comment marker): a second small
 * corner button on each tile, `CapabilityTile.tsx`'s own `onInspectClick`,
 * opens this content scoped to that tile without touching the tile's own
 * primary link.
 *
 * Selection's own metrics (oldest lifecycle stage, worst criticality,
 * worst fit, OT share) are always the *direct*, per-capability facts
 * `metrics.ts` already computes for an L2/L3 tile's own tone — a
 * deliberate, documented simplification for L1: the tile's own tone
 * shown alongside it is a *rolled-up* aggregate over the whole subtree
 * (`aggregateTileColourFor`/`capabilityRollup.ts`), so an L1 capability's
 * Selection panel can show a different (narrower, more precise) picture
 * than its own tile's tone chip. Both are true facts, just at different
 * scopes; rolling Selection up to match would need `capabilities`/
 * `capabilitiesById`/`selfOwnedIds`'s own subtree walk threaded in here
 * too, not worth it for this rollout.
 */
export interface CapabilityMapInspectorContentProps {
  selectedCapability: ElementsHeadRow | null;
  selectedLevel: 1 | 2 | 3 | null;
  supportsEdges: readonly RelationshipsHeadRow[];
  systemsById: ReadonlyMap<UUID, ElementsHeadRow>;
  ownsEdges: readonly RelationshipsHeadRow[];
  actorsById: ReadonlyMap<UUID, ElementsHeadRow>;
  /** `src/db/healthFindings.ts`'s `computeSelfOwnedCapabilityIds` result — used only as a fallback note when this capability has no *direct* `owns` edge of its own (`ownersByRole` below empty) but is still covered via a supporting system's own owner; a specific owner name isn't resolved for that indirect case (out of scope for this rollout). */
  selfOwnedIds: ReadonlySet<UUID>;
  elementHref: (elementId: UUID) => string;
  orgSlug: string;
  modelSlug: string;
  refParam: string;

  colourBy: ColourByMode;
  onColourByChange: (mode: ColourByMode) => void;
  hasSystems: boolean;

  reorderMode: boolean;
  onReorderModeChange: (mode: boolean) => void;
  /** Whether the caller has edit rights to reorder at all — omits the checkbox entirely (not shown disabled) when `false`, same convention `CapabilityMapView.tsx`'s own `reorderCapability` prop already uses. */
  canReorder: boolean;
}

export function CapabilityMapInspectorContent({
  selectedCapability,
  selectedLevel,
  supportsEdges,
  systemsById,
  ownsEdges,
  actorsById,
  selfOwnedIds,
  elementHref,
  orgSlug,
  modelSlug,
  refParam,
  colourBy,
  onColourByChange,
  hasSystems,
  reorderMode,
  onReorderModeChange,
  canReorder,
}: CapabilityMapInspectorContentProps) {
  const colourById = useId();
  const reorderModeId = useId();

  const supportingSystems = selectedCapability ? capabilityMapInspectorSupportingSystems(selectedCapability.element_id, supportsEdges, systemsById) : [];
  const owners = selectedCapability ? ownersByRole(selectedCapability.element_id, ownsEdges, actorsById) : new Map<string, ElementsHeadRow[]>();
  const oldest = selectedCapability ? oldestLifecycleStage(selectedCapability.element_id, supportsEdges, systemsById) : null;
  const criticality = selectedCapability ? worstCriticality(selectedCapability.element_id, supportsEdges, systemsById) : null;
  const fit = selectedCapability ? worstFitForPurpose(selectedCapability.element_id, supportsEdges) : null;
  const agents = selectedCapability ? agentShareOf(selectedCapability.element_id, supportsEdges, systemsById) : { agents: 0, total: 0, worst: null };
  const ot = selectedCapability ? otShareOf(selectedCapability.element_id, supportsEdges, systemsById) : { ot: 0, total: 0 };

  return (
    <>
      <CollapsibleSection title="Selection">
        {selectedCapability ? (
          <div className={styles.selection}>
            <Text as="p" size="sm" className={styles.selectionName}>
              {selectedCapability.name}
            </Text>
            <div className={styles.attributeRow}>
              <Text as="span" size="sm" tone="muted">
                Type
              </Text>
              <Text as="span" size="sm">
                Capability (L{selectedLevel ?? '?'})
              </Text>
            </div>
            {oldest !== null && (
              <div className={styles.attributeRow}>
                <Text as="span" size="sm" tone="muted">
                  Lifecycle
                </Text>
                <Chip tone={LIFECYCLE_TONE[oldest]}>{oldest}</Chip>
              </div>
            )}
            {criticality !== null && (
              <div className={styles.attributeRow}>
                <Text as="span" size="sm" tone="muted">
                  Criticality
                </Text>
                <Chip tone={CRITICALITY_TONE[criticality]}>{criticality}</Chip>
              </div>
            )}
            {fit !== null && (
              <div className={styles.attributeRow}>
                <Text as="span" size="sm" tone="muted">
                  Fit for purpose
                </Text>
                <Chip tone={fitForPurposeToneFor(fit)}>{fit}</Chip>
              </div>
            )}
            {agents.agents > 0 && agents.worst !== null && (
              <div className={styles.attributeRow}>
                <Text as="span" size="sm" tone="muted">
                  Agent share
                </Text>
                <Chip tone={AI_AUTONOMY_TONE[agents.worst]}>
                  {agents.agents}/{agents.total} AI agents · {aiAutonomyLabel(agents.worst).toLowerCase()}
                </Chip>
              </div>
            )}
            {ot.ot > 0 && (
              <div className={styles.attributeRow}>
                <Text as="span" size="sm" tone="muted">
                  OT share
                </Text>
                <Chip tone="warn">
                  {ot.ot}/{ot.total} systems OT
                </Chip>
              </div>
            )}
            <div className={styles.subsection}>
              <Text as="h3" size="sm" tone="muted">
                Owners
              </Text>
              {owners.size > 0 ? (
                <ul className={styles.list}>
                  {[...owners.entries()].map(([role, roleOwners]) => (
                    <li key={role}>
                      <Text as="span" size="sm" tone="muted">
                        {capitalize(role)}:{' '}
                      </Text>
                      {roleOwners.map((owner, i) => (
                        <span key={owner.element_id}>
                          {i > 0 && ', '}
                          <Link to={elementHref(owner.element_id)}>{owner.name}</Link>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : (
                <Text as="p" size="sm" tone="muted">
                  {selfOwnedIds.has(selectedCapability.element_id) ? 'Owned (via a supporting system)' : 'No owner recorded'}
                </Text>
              )}
            </div>
          </div>
        ) : (
          <Text as="p" size="sm" tone="muted">
            Nothing inspected. Click the ⓘ on a tile to inspect it.
          </Text>
        )}
      </CollapsibleSection>

      {selectedCapability && (
        <CollapsibleSection title="Connections" meta={supportingSystems.length > 0 ? `(${String(supportingSystems.length)})` : undefined}>
          <ul className={styles.list}>
            {supportingSystems.length === 0 && (
              <li>
                <Text as="span" size="sm" tone="muted">
                  No supporting systems.
                </Text>
              </li>
            )}
            {supportingSystems.map((s) => (
              <li key={s.systemId}>
                <Link to={elementHref(s.systemId)}>{s.systemName}</Link>
              </li>
            ))}
          </ul>
          <LandscapeZoomLink capabilityId={selectedCapability.element_id} count={supportingSystems.length} orgSlug={orgSlug} modelSlug={modelSlug} refParam={refParam} />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title={
          <span className={styles.filtersTitle}>
            <SlidersHorizontal size={14} aria-hidden="true" /> Filters
          </span>
        }
      >
        <div className={styles.filters}>
          <label htmlFor={colourById}>
            <Text as="span" size="sm" tone="muted">
              Colour by
            </Text>
          </label>
          <select
            id={colourById}
            className={styles.select}
            value={colourBy}
            onChange={(e) => {
              onColourByChange(e.target.value as ColourByMode);
            }}
          >
            <option value="none">None</option>
            {COLOUR_BY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {colourBy === 'none' && !hasSystems && (
            <Text as="span" size="sm" tone="muted">
              Link systems to capabilities to see coverage.
            </Text>
          )}
          {canReorder && (
            <span className={styles.reorderModeToggle}>
              <input
                id={reorderModeId}
                type="checkbox"
                checked={reorderMode}
                onChange={(e) => {
                  onReorderModeChange(e.target.checked);
                }}
              />
              <label htmlFor={reorderModeId}>
                <Text as="span" size="sm" tone="muted">
                  Reorder mode
                </Text>
              </label>
            </span>
          )}
        </div>
      </CollapsibleSection>

      {selectedCapability && (
        <CollapsibleSection title="Actions">
          <div className={styles.actions}>
            <Link to={elementHref(selectedCapability.element_id)}>Open element →</Link>
          </div>
        </CollapsibleSection>
      )}
    </>
  );
}
