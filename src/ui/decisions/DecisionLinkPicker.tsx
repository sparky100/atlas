import type { UUID } from '../../contracts/delta';
import { useRelationshipTargetSearch } from '../elements/useRelationshipTargetSearch';
import { Chip } from '../components/Chip/Chip';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import styles from './DecisionLinkPicker.module.css';

export interface DecisionLinkPickerProps {
  commitId: UUID;
  modelId: UUID;
  selected: readonly { elementId: UUID; name: string }[];
  onAdd: (elementId: UUID, name: string) => void;
  onRemove: (elementId: UUID) => void;
}

/**
 * A decision's own "capability + systems" links (F3's own creation-form
 * field list) — search-and-pick, multiple, no create-fallback (the same
 * shape `CapabilitySupportsPicker.tsx` already established for a single
 * fixed target type; this widens it to both `capability` and `system` and
 * accumulates a chosen list instead of picking exactly one). Each pick
 * becomes a `decision_links` row with `linked_type: 'element'` once the
 * decision itself is created (`useDecisions.ts`'s own
 * `createDecisionWithLinks`) — this component only manages the in-progress
 * selection, it never writes anything itself.
 */
export function DecisionLinkPicker({ commitId, modelId, selected, onAdd, onRemove }: DecisionLinkPickerProps) {
  const search = useRelationshipTargetSearch(commitId, modelId, ['capability', 'system'], '00000000-0000-0000-0000-000000000000');
  const selectedIds = new Set(selected.map((s) => s.elementId));
  const results = search.results.filter((r) => !selectedIds.has(r.element_id));

  return (
    <div className={styles.picker}>
      {selected.length > 0 && (
        <ul className={styles.selectedList}>
          {selected.map((s) => (
            <li key={s.elementId}>
              <Chip tone="neutral">{s.name}</Chip>
              <button
                type="button"
                className={styles.removeButton}
                aria-label={`Remove ${s.name}`}
                onClick={() => {
                  onRemove(s.elementId);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        type="text"
        className={styles.input}
        placeholder="Search capabilities or systems this decision concerns…"
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
      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((result) => (
            <li key={result.element_id}>
              <button
                type="button"
                className={styles.resultRow}
                onClick={() => {
                  onAdd(result.element_id, result.name);
                }}
              >
                <ElementTypeGlyph type={result.element_type} />
                <Text as="span">{result.name}</Text>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
