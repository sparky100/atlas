import { Link } from 'react-router';
import { protocolSides } from './protocolSides';
import type { UUID } from '../../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../../contracts/rows';
import { Chip } from '../Chip/Chip';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import { attributesRecord } from '../../elements/attributesRecord';
import { moduleDisplayNameFromMap } from '../../elements/moduleDisplayName';
import styles from './PlatformFlowsSection.module.css';

export interface PlatformFlowsSectionProps {
  orgSlug: string;
  modelSlug: string;
  flows: readonly RelationshipsHeadRow[];
  endpoints: ReadonlyMap<UUID, ElementsHeadRow>;
  /** ADR-026: the platform's interfaces (or the one interface whose page this is), by id — each flow says which it goes through. */
  interfaces?: ReadonlyMap<UUID, ElementsHeadRow> | undefined;
}

/**
 * Prompt 7k item 4's "Flows via this platform" — every `uses`/`flows_to`
 * edge naming this element (a `kind: 'integration_platform'` system) as
 * `via`. `ElementPage.tsx` only mounts this section at all when the
 * current element actually is one (`isIntegrationPlatform`), so the empty
 * state here means "a real platform with nothing routed through it yet"
 * — exactly the fact `findUnusedIntegrationPlatforms`
 * (`src/db/healthFindings.ts`) turns into its own health finding.
 *
 * `endpoints` must also carry each container endpoint's own parent, not
 * only the flow's own `from`/`to` rows — `moduleDisplayNameFromMap` needs
 * it to resolve "Platform · Module" for a source/target that's itself a
 * module of some other platform (both callers, `ElementPage.tsx` and
 * `IntegrationPlatformContextView.tsx`, already merge it in).
 */
export function PlatformFlowsSection({ orgSlug, modelSlug, flows, endpoints, interfaces }: PlatformFlowsSectionProps) {
  if (flows.length === 0) {
    return <EmptyState>Nothing flows via this yet.</EmptyState>;
  }

  return (
    <ul className={styles.list}>
      {flows.map((flow) => {
        const from = endpoints.get(flow.from_element_id);
        const to = endpoints.get(flow.to_element_id);
        const attrs = attributesRecord(flow.attributes);
        const description = attrs.description;
        const viaInterface = typeof attrs.via === 'string' ? interfaces?.get(attrs.via) : undefined;
        const sides = protocolSides(attrs);
        return (
          <li key={flow.relationship_id} className={styles.row}>
            <div className={styles.endpoints}>
              <EndpointLink orgSlug={orgSlug} modelSlug={modelSlug} elementId={flow.from_element_id} element={from} endpoints={endpoints} />
              <Text as="span" tone="muted" size="sm">
                →
              </Text>
              <EndpointLink orgSlug={orgSlug} modelSlug={modelSlug} elementId={flow.to_element_id} element={to} endpoints={endpoints} />
              <Chip tone="neutral">{flow.relationship_type.replace('_', ' ')}</Chip>
            </div>
            {(viaInterface !== undefined || sides !== null) && (
              <Text as="p" tone="muted" size="sm">
                {viaInterface !== undefined && <>via {viaInterface.name}</>}
                {viaInterface !== undefined && sides !== null && ' · '}
                {sides}
              </Text>
            )}
            {typeof description === 'string' && description.trim() !== '' && (
              <Text as="p" tone="muted" size="sm">
                “{description}”
              </Text>
            )}
          </li>
        );
      })}
    </ul>
  );
}


function EndpointLink({
  orgSlug,
  modelSlug,
  elementId,
  element,
  endpoints,
}: {
  orgSlug: string;
  modelSlug: string;
  elementId: UUID;
  element: ElementsHeadRow | undefined;
  endpoints: ReadonlyMap<UUID, ElementsHeadRow>;
}) {
  if (!element) {
    return (
      <Text as="span" tone="faint">
        {elementId}
      </Text>
    );
  }
  return (
    <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${element.element_id}`} className={styles.link}>
      <ElementTypeGlyph type={element.element_type} />
      <Text as="span">{moduleDisplayNameFromMap(element, endpoints)}</Text>
    </Link>
  );
}
