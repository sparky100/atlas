import { useId, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { filterCapabilityMaps } from './capabilityMapPickerFilter';
import { CapabilityMapPickerCard } from './CapabilityMapPickerCard';
import { useCapabilityImport } from './useCapabilityImport';
import styles from './CapabilityMapImportPanel.module.css';

export interface CapabilityMapImportPanelProps {
  modelId: UUID;
  userId: UUID | null;
  onImported: () => void;
}

/**
 * The empty scaffold's "import" affordance (Sprint U2 step 2, wiring
 * updated for ADR-018): shown for an unresolvable ref (an unknown tag or
 * branch) and, in the far more common case since main always has a real
 * head now, whenever main resolves fine but has no capabilities yet — the
 * primary action there, alongside "Add a capability" (CapabilityMapView's
 * own empty-state form) as the always-available alternative. Owner/
 * architect only, same gate as every other write here (ADR-015). A sector
 * with no seedable starter map yet shows "No starter maps are available
 * yet" plainly, not hidden, per CLAUDE.md rule 7 — "Add a capability" is
 * still there either way.
 *
 * Sprint U4-1 C6: the picker also lists draft maps ("draft maps are
 * seedable into a model for review") — `CapabilityMapPickerCard`'s own
 * "Draft" Chip is never colour alone (§6.3/§8.4/§8.7), and never silently
 * indistinguishable from a real, reviewed, published map, which is
 * exactly what seeding one is meant to let a reviewer check.
 *
 * Sprint U4-2a item 4: cards (`CapabilityMapPickerCard.tsx`) replace the
 * old plain list — each with its own "Preview" and "About this map"
 * disclosures — plus this component's own search box, once eight-plus
 * starter maps stopped being scannable as a bare list. The search box
 * itself is omitted while there's nothing worth filtering (0 or 1 map) —
 * same "omit, don't disable" convention this file already follows for
 * "No starter maps are available yet."
 */
export function CapabilityMapImportPanel({ modelId, userId, onImported }: CapabilityMapImportPanelProps) {
  const { status, maps, error, importMap } = useCapabilityImport({ modelId, userId, onImported });
  const [query, setQuery] = useState('');
  const searchId = useId();

  const filteredMaps = filterCapabilityMaps(maps, query);

  return (
    <Panel>
      <Text as="h2" size="lg">
        Start from a capability map
      </Text>
      <Text as="p" tone="muted">
        This model has no capabilities yet. Seed it from a starter map, or add capabilities by hand once you're on the map.
      </Text>
      {status === 'loadingMaps' && <Text tone="muted">Loading starter maps…</Text>}
      {status !== 'loadingMaps' && maps.length === 0 && (
        <Text as="p" tone="muted">
          No starter maps are available yet.
        </Text>
      )}

      {maps.length > 1 && (
        <div className={styles.search}>
          <label htmlFor={searchId}>
            <Text as="span" size="sm" tone="muted">
              Search
            </Text>
          </label>
          <input
            id={searchId}
            type="search"
            className={styles.searchInput}
            placeholder="Search by name, sector, or what it covers…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
          />
        </div>
      )}

      {maps.length > 0 && filteredMaps.length === 0 && <EmptyState>No starter maps match &ldquo;{query}&rdquo;.</EmptyState>}

      {filteredMaps.length > 0 && (
        <ul className={styles.grid}>
          {filteredMaps.map((map) => (
            <CapabilityMapPickerCard
              key={map.id}
              map={map}
              importDisabled={status === 'seeding'}
              onImport={(mapId) => { void importMap(mapId); }}
            />
          ))}
        </ul>
      )}
      {error !== null && (
        <Text as="p" tone="default">
          {error}
        </Text>
      )}
    </Panel>
  );
}
