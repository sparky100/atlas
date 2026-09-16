import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { VersionDiff, ElementVersionDiff } from '../../engine/versionDiff';
import { Chip } from '../components/Chip/Chip';
import { LinkButton } from '../components/Button/LinkButton';
import { DiffBadge } from '../components/DiffBadge/DiffBadge';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import type { ContextModule } from './contextDiagramData';
import type { PlatformConnection } from './contextGrouping';
import styles from './PlatformStructureView.module.css';

export interface PlatformStructureViewProps {
  hub: ElementsHeadRow;
  modules: readonly ContextModule[];
  connections: readonly PlatformConnection[];
  orgSlug: string;
  modelSlug: string;
  /** The full `ref=...` query fragment (`refQueryParam`), not a bare token — same `ContextView.tsx`/`CapabilityMapView.tsx` doc comment. */
  refParam: string;
  diff?: VersionDiff | null;
}

/**
 * V3 item 2's own "platform context simplified to structure only": the
 * platform tile containing its own module tiles — name, capability chip,
 * lifecycle tone, per module — with no external neighbours, no drawn edges,
 * no labels on this page at all. This is the whole fix for the old
 * multi-module, multi-neighbour crowding problem at the platform level:
 * item 3's "no further edge-routing/label-collision engineering is needed
 * there" is true precisely because this page never draws an edge in the
 * first place. Each module tile links straight to that module's own
 * Context page (item 1) — a platform's modules are never grouped alongside
 * neighbours on one diagram any more; a module's own neighbours live only
 * on its own page.
 *
 * A platform's rare genuine *direct* relationship (not really one module's)
 * is never silently dropped (CLAUDE.md rule 7) — listed as plain text below
 * the module grid ("Platform-level connections: ..."), each still a real
 * link, just never a canvas node or a drawn edge (`computePlatformConnections`'s
 * own comment explains why this can happen at all).
 */
export function PlatformStructureView({ hub, modules, connections, orgSlug, modelSlug, refParam, diff = null }: PlatformStructureViewProps) {
  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}?${refParam}`;
  const moduleContextHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/context/${elementId}?${refParam}`;
  const containersHref = `/o/${orgSlug}/m/${modelSlug}/container/${hub.element_id}?${refParam}`;
  const hubExternal = attributesRecord(hub.attributes).isExternal === true;
  const diffById = new Map<UUID, ElementVersionDiff>(diff?.elements.map((e) => [e.elementId, e]) ?? []);
  const hubDiff = diffById.get(hub.element_id);

  return (
    <div>
      <div className={styles.hub}>
        <div className={styles.hubTitle}>
          <ElementTypeGlyph type="system" external={hubExternal} />
          <Link to={elementHref(hub.element_id)}>
            <Text as="span" size="lg">
              {hub.name}
            </Text>
          </Link>
          {hubExternal && <Chip tone="neutral">external</Chip>}
          {diff && hubDiff && <DiffBadge state={hubDiff.state} changedCount={hubDiff.state === 'changed' ? hubDiff.changedAttributes.length : undefined} />}
        </div>
        {/* The same "descend a level" affordance a plain system's context page offers (ContextView.tsx's identical link) — the place to actually add or edit this platform's modules, distinct from this read-only structure page. */}
        <LinkButton to={containersHref} variant="secondary">
          Containers →
        </LinkButton>
      </div>

      <div className={styles.platformTile}>
        <div className={styles.moduleGrid} role="list">
          {modules.map((module) => {
            const tone = module.lifecycleStatus !== null ? lifecycleToneFor(module.lifecycleStatus) : undefined;
            return (
              <Link key={module.elementId} to={moduleContextHref(module.elementId)} className={styles.moduleTile} data-tone={tone ?? 'neutral'} role="listitem">
                <Text as="span" className={styles.moduleName}>
                  {module.name}
                </Text>
                {module.capabilityName && <Chip tone="neutral">{module.capabilityName}</Chip>}
              </Link>
            );
          })}
        </div>
      </div>

      {connections.length > 0 && (
        <div className={styles.connections}>
          <Text as="h2" size="sm" tone="muted">
            Platform-level connections
          </Text>
          <ul className={styles.connectionsList}>
            {connections.map((connection) => (
              <li key={connection.relationshipId}>
                <Link to={elementHref(connection.otherElementId)}>{connection.otherName}</Link>{' '}
                <Text as="span" size="sm" tone="muted">
                  {connection.label}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
