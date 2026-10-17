/**
 * The Integrations page's rows: one per `uses`/`flows_to` link, routed
 * through an integration platform (and optionally one of its interfaces)
 * or direct (ADR-026). Pure — `useIntegrations.ts` loads the model's
 * elements and links once and this turns them into rows.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { INTERFACE_TYPE_LABELS } from '../../contracts/attributeSchema';
import { attributesRecord } from '../elements/attributesRecord';
import { moduleDisplayNameFromMap } from '../elements/moduleDisplayName';
import { protocolSides } from '../components/PlatformFlowsSection/protocolSides';

export type IntegrationRouting = 'direct' | 'platform' | 'interface';

export interface IntegrationRow {
  relationshipId: UUID;
  linkType: 'uses' | 'flows_to';
  source: ElementsHeadRow;
  target: ElementsHeadRow;
  sourceName: string;
  targetName: string;
  /** The integration platform managing this link; `null` for a direct link. */
  platform: ElementsHeadRow | null;
  /** The interface the link goes through; `null` when it names only the platform, or is direct. */
  integrationInterface: ElementsHeadRow | null;
  interfaceTypeLabel: string | null;
  transformation: string | null;
  routing: IntegrationRouting;
  /** "File (SFTP) in → REST API out", or a single protocol; `null` when none is recorded. */
  protocol: string | null;
  dataClassification: string | null;
  description: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** `via` resolved to its platform and interface. A `via` that no longer resolves to a live element counts as direct, never dropped. */
function resolveVia(via: unknown, elementsById: ReadonlyMap<UUID, ElementsHeadRow>): { platform: ElementsHeadRow | null; integrationInterface: ElementsHeadRow | null } {
  if (typeof via !== 'string') return { platform: null, integrationInterface: null };
  const element = elementsById.get(via);
  if (!element) return { platform: null, integrationInterface: null };
  if (element.element_type === 'container') {
    const parent = element.parent_id !== null ? elementsById.get(element.parent_id) ?? null : null;
    return { platform: parent, integrationInterface: element };
  }
  return { platform: element, integrationInterface: null };
}

/** Links whose endpoints are not in `elementsById` are skipped — nothing to show for an unresolvable end. */
export function buildIntegrationRows(links: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): IntegrationRow[] {
  const rows: IntegrationRow[] = [];
  for (const link of links) {
    if (link.relationship_type !== 'uses' && link.relationship_type !== 'flows_to') continue;
    const source = elementsById.get(link.from_element_id);
    const target = elementsById.get(link.to_element_id);
    if (!source || !target) continue;
    const attrs = attributesRecord(link.attributes);
    const { platform, integrationInterface } = resolveVia(attrs.via, elementsById);
    const interfaceAttrs = integrationInterface ? attributesRecord(integrationInterface.attributes) : {};
    const interfaceType = interfaceAttrs.interfaceType;
    rows.push({
      relationshipId: link.relationship_id,
      linkType: link.relationship_type,
      source,
      target,
      sourceName: moduleDisplayNameFromMap(source, elementsById),
      targetName: moduleDisplayNameFromMap(target, elementsById),
      platform,
      integrationInterface,
      interfaceTypeLabel: typeof interfaceType === 'string' && interfaceType in INTERFACE_TYPE_LABELS ? INTERFACE_TYPE_LABELS[interfaceType as keyof typeof INTERFACE_TYPE_LABELS] : null,
      transformation: text(interfaceAttrs.transformation),
      routing: integrationInterface ? 'interface' : platform ? 'platform' : 'direct',
      protocol: protocolSides(attrs),
      dataClassification: text(attrs.dataClassification),
      description: text(attrs.description),
    });
  }
  return rows;
}
