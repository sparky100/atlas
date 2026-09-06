import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useCapabilityImport } from './useCapabilityImport';
import type { UUID } from '../../contracts/delta';
import styles from './CapabilityMapImportPanel.module.css';

export interface CapabilityMapImportPanelProps {
  modelId: UUID;
  userId: UUID | null;
  onImported: () => void;
}

/**
 * The empty scaffold's "import" affordance (Sprint U2 step 2): shown only
 * while a model's main branch has no commits at all (§5.1's "the first
 * commit of a model"), and only to owner/architect — the same gate as
 * every other write here (ADR-015). `content/capability-maps/` ships empty
 * this sprint (real sector maps are Prompt 9), so `maps` will usually be
 * empty too; that's shown plainly, not hidden, per CLAUDE.md rule 7.
 */
export function CapabilityMapImportPanel({ modelId, userId, onImported }: CapabilityMapImportPanelProps) {
  const { status, maps, error, importMap } = useCapabilityImport({ modelId, userId, onImported });

  return (
    <Panel>
      <Text as="h2" size="lg">
        Start from a capability map
      </Text>
      <Text as="p" tone="muted">
        This model has no capabilities yet. Seed it from a published starter map, or add capabilities by hand once you're on the map.
      </Text>
      {status === 'loadingMaps' && <Text tone="muted">Loading starter maps…</Text>}
      {status !== 'loadingMaps' && maps.length === 0 && (
        <Text as="p" tone="muted">
          No starter maps are published yet.
        </Text>
      )}
      {maps.length > 0 && (
        <ul className={styles.list}>
          {maps.map((map) => (
            <li key={map.id} className={styles.row}>
              <div>
                <Text as="span">
                  {map.sector} v{map.version}
                </Text>
                <Text as="p" tone="muted" size="sm">
                  {map.source_description}
                </Text>
              </div>
              <Button variant="secondary" disabled={status === 'seeding'} onClick={() => void importMap(map.id)}>
                {status === 'seeding' ? 'Importing…' : 'Import'}
              </Button>
            </li>
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
