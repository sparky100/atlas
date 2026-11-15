import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { ElementVersionDiff, VersionDiff } from '../../engine/versionDiff';
import { Chip } from '../components/Chip/Chip';
import { DiffBadge } from '../components/DiffBadge/DiffBadge';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { PlatformFlowsSection } from '../components/PlatformFlowsSection/PlatformFlowsSection';
import { Text } from '../components/Text/Text';
import { isBoundaryCrossingPair } from '../../db/healthFindings';
import { attributesRecord } from '../elements/attributesRecord';
import { resolveElementDomain } from '../elements/systemDomain';
import { useIsNarrowViewport } from '../landscape/useIsNarrowViewport';
import { IntegrationPlatformDiagramCanvas } from './IntegrationPlatformDiagramCanvas';
import { IntegrationPlatformMobileList } from './IntegrationPlatformMobileList';
import type { PlatformFlowEdgeInput } from './integrationPlatformContextLayout';
import styles from './IntegrationPlatformContextView.module.css';

export interface IntegrationPlatformContextViewProps {
  hub: ElementsHeadRow;
  flows: readonly RelationshipsHeadRow[];
  endpoints: ReadonlyMap<UUID, ElementsHeadRow>;
  /** ADR-026: the platform's interfaces by id (or, on an interface's own view, just it) — flows naming one are grouped under it. */
  interfaces?: ReadonlyMap<UUID, ElementsHeadRow> | undefined;
  orgSlug: string;
  modelSlug: string;
  /** The full `ref=...` query fragment (`refQueryParam`), not a bare token — same `ContextView.tsx`/`PlatformStructureView.tsx` doc comment. */
  refParam: string;
  diff?: VersionDiff | null;
}

const MOBILE_BREAKPOINT_PX = 768;

/** `description` if the relationship carries a real one, else the bare relationship type (`PlatformFlowsSection.tsx`'s own Chip already shows the type separately, but this canvas has only one pill per segment to work with, so a missing verb still leaves something legible on the line rather than a blank pill). */
/** ADR-026: the interface a flow's `via` names, or null when it names the platform itself (or anything this view doesn't hold as an interface). */
function viaInterfaceOf(flow: RelationshipsHeadRow, interfaces: ReadonlyMap<UUID, ElementsHeadRow>): UUID | null {
  const via = (flow.attributes as Record<string, unknown> | null)?.via;
  return typeof via === 'string' && interfaces.has(via) ? via : null;
}

function verbLabelFor(edge: RelationshipsHeadRow): string {
  const description = attributesRecord(edge.attributes).description;
  if (typeof description === 'string' && description.trim() !== '') return description;
  return edge.relationship_type.replace('_', ' ');
}

function classificationLabelFor(edge: RelationshipsHeadRow): string | null {
  const value = attributesRecord(edge.attributes).dataClassification;
  return typeof value === 'string' && value.trim() !== '' ? value.replace('_', ' ') : null;
}

/**
 * Integration platform context (per-prompt spec): for a `kind:
 * 'integration_platform'` system, the diagram renders every via-flow
 * routed through it as its own content — the platform tile centred,
 * sources on the left, targets on the right, each flow drawn as
 * source → platform → target (`IntegrationPlatformDiagramCanvas.tsx`).
 * The header states the same three counts the prompt names ("N flows via
 * this platform · M sources · K targets"); the same flows list the
 * element page's own "Flows via this platform" section already shows
 * (`PlatformFlowsSection.tsx`, reused verbatim) sits below the canvas, so
 * this page never invents a second definition of that list. Mobile drops
 * the canvas for a list grouped by source instead
 * (`IntegrationPlatformMobileList.tsx`), which alone covers what both the
 * canvas and the below-canvas list show on desktop.
 */
export function IntegrationPlatformContextView({ hub, flows, endpoints, interfaces = new Map(), orgSlug, modelSlug, refParam, diff = null }: IntegrationPlatformContextViewProps) {
  const narrow = useIsNarrowViewport(MOBILE_BREAKPOINT_PX);
  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}?${refParam}`;
  const neighbourContextHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/context/${elementId}?${refParam}`;
  const hubExternal = attributesRecord(hub.attributes).isExternal === true;
  const diffById = new Map<UUID, ElementVersionDiff>(diff?.elements.map((e) => [e.elementId, e]) ?? []);
  const hubDiff = diffById.get(hub.element_id);

  // ADR-026: an interface's own view reads "via this interface".
  const noun = hub.element_type === 'container' ? 'interface' : 'platform';
  const sourceIds = [...new Set(flows.map((f) => f.from_element_id))];
  const targetIds = [...new Set(flows.map((f) => f.to_element_id))];

  // Prompt's own "IT/OT boundary crossings highlighted": the same
  // `resolveElementDomain`/`isBoundaryCrossingPair` pair the architect
  // door's own boundary-crossings finding already uses — one definition
  // of "what counts as a crossing," not a second one for this diagram.
  const edgeInputs: PlatformFlowEdgeInput[] = flows.map((flow) => {
    const from = endpoints.get(flow.from_element_id);
    const to = endpoints.get(flow.to_element_id);
    const crossesBoundary = from !== undefined && to !== undefined && isBoundaryCrossingPair(resolveElementDomain(from, endpoints), resolveElementDomain(to, endpoints));
    return {
      id: flow.relationship_id,
      sourceId: flow.from_element_id,
      targetId: flow.to_element_id,
      verbLabel: verbLabelFor(flow),
      classificationLabel: classificationLabelFor(flow),
      crossesBoundary,
      interfaceId: viaInterfaceOf(flow, interfaces),
    };
  });

  // A key for the diagram, listing only what is actually drawn in it (no entry for something that isn't there).
  const diagramElements = [hub, ...sourceIds, ...targetIds].map((x) => (typeof x === 'string' ? endpoints.get(x) : x));
  const legendItems: string[] = [];
  if (edgeInputs.some((e) => e.crossesBoundary)) legendItems.push('Heavy line, tagged IT/OT: the flow crosses between IT and OT');
  if (diagramElements.some((e) => e !== undefined && attributesRecord(e.attributes).lifecycleStatus === 'retiring')) legendItems.push('Cream tile: retiring');
  if (diagramElements.some((e) => e !== undefined && attributesRecord(e.attributes).isExternal === true)) legendItems.push('Dashed tile: outside our organisation');

  return (
    <div>
      <div className={styles.hub}>
        <div className={styles.hubTitle}>
          <ElementTypeGlyph type={hub.element_type} external={hubExternal} />
          <Text as="span" size="lg">
            {hub.name}
          </Text>
          {hubExternal && <Chip tone="neutral">external</Chip>}
          {diff && hubDiff && <DiffBadge state={hubDiff.state} changedCount={hubDiff.state === 'changed' ? hubDiff.changedAttributes.length : undefined} />}
        </div>
      </div>

      <Text as="p" tone="muted" size="sm" className={styles.stats}>
        {flows.length} {flows.length === 1 ? 'flow' : 'flows'} via this {noun} · {sourceIds.length} {sourceIds.length === 1 ? 'source' : 'sources'} · {targetIds.length} {targetIds.length === 1 ? 'target' : 'targets'}
      </Text>

      {flows.length === 0 ? (
        <EmptyState>Nothing flows via this {noun} yet.</EmptyState>
      ) : narrow ? (
        <IntegrationPlatformMobileList flows={flows} endpoints={endpoints} elementHref={elementHref} interfaces={interfaces} />
      ) : (
        <>
          <div className={styles.diagram}>
            {legendItems.length > 0 && (
              <ul className={styles.legend} aria-label="Key to the diagram">
                {legendItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            <IntegrationPlatformDiagramCanvas hub={hub} interfaces={interfaces} sourceIds={sourceIds} targetIds={targetIds} edges={edgeInputs} elementsById={endpoints} neighbourContextHref={neighbourContextHref} elementHref={elementHref} />
          </div>
          <div className={styles.flowsList}>
            <CollapsibleSection title={`Flows via this ${noun}`} meta={`(${String(flows.length)})`} defaultOpen={false}>
              <PlatformFlowsSection orgSlug={orgSlug} modelSlug={modelSlug} flows={flows} endpoints={endpoints} interfaces={interfaces} />
            </CollapsibleSection>
          </div>
        </>
      )}
    </div>
  );
}
