import type { UUID } from '../../contracts/delta';
import { useRelationshipTargetSearch } from '../elements/useRelationshipTargetSearch';
import { Text } from '../components/Text/Text';
import styles from './HomeSearch.module.css';

export interface CapabilitySupportsPickerProps {
  commitId: UUID;
  modelId: UUID;
  selectedName: string | null;
  onSelect: (capabilityId: UUID, name: string) => void;
}

/**
 * Handoff — Flow: Add a system, step 4's "Supports which capability?" and
 * decision 7: the right component to reuse is `useRelationshipTargetSearch`
 * (a single fixed target type, no create-fallback — the same shape
 * `RelationshipAdd.tsx` already uses for an existing element's own "+ Add"),
 * not `HomeSearch`'s own multi-type door search. The system being created
 * has no id yet, so there is nothing to exclude from the result list —
 * `excludeElementId` gets an id no real element will ever have.
 */
export function CapabilitySupportsPicker({ commitId, modelId, selectedName, onSelect }: CapabilitySupportsPickerProps) {
  const search = useRelationshipTargetSearch(commitId, modelId, ['capability'], '00000000-0000-0000-0000-000000000000');

  if (selectedName) {
    return (
      <Text as="p" size="sm">
        Supports <strong>{selectedName}</strong>
      </Text>
    );
  }

  return (
    <div className={styles.capabilityPicker}>
      <input
        type="text"
        className={styles.input}
        placeholder="Search capabilities…"
        value={search.query}
        onChange={(e) => {
          search.setQuery(e.target.value);
        }}
      />
      {search.status === 'loading' && (
        <Text as="p" tone="muted" size="sm">
          Loading…
        </Text>
      )}
      {search.results.length > 0 && (
        <ul className={styles.results}>
          {search.results.map((result) => (
            <li key={result.element_id}>
              <button
                type="button"
                className={styles.resultRow}
                onClick={() => {
                  onSelect(result.element_id, result.name);
                }}
              >
                <Text as="span">{result.name}</Text>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
