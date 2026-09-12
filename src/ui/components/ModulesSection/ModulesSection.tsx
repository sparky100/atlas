import { Link } from 'react-router';
import type { UUID } from '../../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../../contracts/rows';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import styles from './ModulesSection.module.css';

export interface ModulesSectionProps {
  orgSlug: string;
  modelSlug: string;
  /** The platform's own children (`ElementPageData.children`) — every one of these is a module, whether or not it supports a capability yet. */
  modules: readonly ElementsHeadRow[];
  moduleSupportsEdges: readonly RelationshipsHeadRow[];
  moduleSupportsCapabilities: ReadonlyMap<UUID, ElementsHeadRow>;
}

/**
 * "Platforms and modules"'s "Platform element page lists modules grouped
 * by capability" — one labelled group per capability a module supports,
 * mirroring `RelationshipsSection.tsx`'s own "labelled header + list of
 * rows" shape (`StructureSection.tsx`'s children list is flat, not the
 * right precedent here: a module's whole point is which capability it
 * supports, not just that it exists). A module supporting nothing yet —
 * the common state for one just created via "+ Add module" — lists under
 * its own trailing group rather than disappearing, since `ElementPage.tsx`
 * only mounts this section at all for a real platform, so an empty overall
 * list here means "a real platform with no modules recorded yet".
 */
export function ModulesSection({ orgSlug, modelSlug, modules, moduleSupportsEdges, moduleSupportsCapabilities }: ModulesSectionProps) {
  if (modules.length === 0) {
    return <EmptyState>No modules recorded for this platform yet.</EmptyState>;
  }

  const modulesById = new Map(modules.map((m) => [m.element_id, m]));
  const moduleIdsByCapabilityId = new Map<UUID, UUID[]>();
  const supportedModuleIds = new Set<UUID>();
  for (const edge of moduleSupportsEdges) {
    if (!modulesById.has(edge.from_element_id)) continue;
    const list = moduleIdsByCapabilityId.get(edge.to_element_id) ?? [];
    list.push(edge.from_element_id);
    moduleIdsByCapabilityId.set(edge.to_element_id, list);
    supportedModuleIds.add(edge.from_element_id);
  }

  const capabilityGroups = [...moduleIdsByCapabilityId.entries()]
    .map(([capabilityId, moduleIds]) => ({ capability: moduleSupportsCapabilities.get(capabilityId), capabilityId, moduleIds: [...new Set(moduleIds)] }))
    .sort((a, b) => (a.capability?.name ?? a.capabilityId).localeCompare(b.capability?.name ?? b.capabilityId));
  const unsupportedModules = modules.filter((m) => !supportedModuleIds.has(m.element_id));

  return (
    <div className={styles.groups}>
      {capabilityGroups.map(({ capability, capabilityId, moduleIds }) => (
        <div key={capabilityId} className={styles.group}>
          <Text as="h3" size="sm" tone="muted">
            {capability ? capability.name : capabilityId} ({moduleIds.length})
          </Text>
          <ul className={styles.list}>
            {moduleIds
              .map((id) => modulesById.get(id))
              .filter((m): m is ElementsHeadRow => m !== undefined)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((module) => (
                <li key={module.element_id}>
                  <ModuleLink orgSlug={orgSlug} modelSlug={modelSlug} module={module} />
                </li>
              ))}
          </ul>
        </div>
      ))}
      {unsupportedModules.length > 0 && (
        <div className={styles.group}>
          <Text as="h3" size="sm" tone="muted">
            Not yet supporting a capability ({unsupportedModules.length})
          </Text>
          <ul className={styles.list}>
            {unsupportedModules.map((module) => (
              <li key={module.element_id}>
                <ModuleLink orgSlug={orgSlug} modelSlug={modelSlug} module={module} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ModuleLink({ orgSlug, modelSlug, module }: { orgSlug: string; modelSlug: string; module: ElementsHeadRow }) {
  return (
    <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${module.element_id}`} className={styles.link}>
      <ElementTypeGlyph type={module.element_type} />
      <Text as="span">{module.name}</Text>
    </Link>
  );
}
