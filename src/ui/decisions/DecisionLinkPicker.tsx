import type { ElementType, UUID } from '../../contracts/delta';
import { moduleDisplayName } from '../elements/moduleDisplayName';
import { useRelationshipTargetSearch } from '../elements/useRelationshipTargetSearch';
import { Chip } from '../components/Chip/Chip';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import styles from './DecisionLinkPicker.module.css';

export interface DecisionLinkPickerProps {
  commitId: UUID;
  modelId: UUID;
  selected: readonly { elementId: UUID; name: string }[];
  /** `elementType` is the picked result's own type — the decision form ignores it, the project form (plan A1) uses it to require at least one capability. */
  onAdd: (elementId: UUID, name: string, elementType: ElementType) => void;
  onRemove: (elementId: UUID) => void;
  /** F10: the project form's own wording; defaults to the decision form's. */
  placeholder?: string;
}

/**
 * A decision's own "capability + systems + containers" links (F3's own
 * creation-form field list) — search-and-pick, multiple, no create-fallback
 * (the same shape `CapabilitySupportsPicker.tsx` already established for a
 * single fixed target type; this widens it to `capability`, `system` and
 * `container` and accumulates a chosen list instead of picking exactly
 * one). `container` matters here specifically: a decision like "Datasphere
 * replaces BW" is about a platform's own module, not the platform itself,
 * and a container search needs the same "Platform · Module" display
 * (`moduleDisplayName`) `RelationshipAdd.tsx` already gives its own results,
 * or two same-named modules of different platforms would be
 * indistinguishable in the list. Each pick becomes a `decision_links` row
 * with `linked_type: 'element'` once the decision itself is created
 * (`useDecisions.ts`'s own `createDecisionWithLinks`) — this component only
 * manages the in-progress selection, it never writes anything itself.
 */
export function DecisionLinkPicker({ commitId, modelId, selected, onAdd, onRemove, placeholder = 'Search capabilities or systems this decision concerns…' }: DecisionLinkPickerProps) {
  const search = useRelationshipTargetSearch(commitId, modelId, ['capability', 'system', 'container'], '00000000-0000-0000-0000-000000000000');
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
        placeholder={placeholder}
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
          {results.map((result) => {
            const name = moduleDisplayName(result, search.resultParents.get(result.element_id) ?? null);
            return (
              <li key={result.element_id}>
                <button
                  type="button"
                  className={styles.resultRow}
                  onClick={() => {
                    onAdd(result.element_id, name, result.element_type);
                  }}
                >
                  <ElementTypeGlyph type={result.element_type} />
                  {/* "Platform · Module" — freezes into the selected chip's own name at pick time, same as `RelationshipAdd.tsx`'s own result row. */}
                  <Text as="span">{name}</Text>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
