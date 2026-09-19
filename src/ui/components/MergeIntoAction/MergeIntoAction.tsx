import { useId, useState } from 'react';
import type { ElementsHeadRow } from '../../../contracts/rows';
import type { UUID } from '../../../contracts/delta';
import type { BranchRow } from '../../../db/types';
import { useElementMerge } from '../../elements/useElementMerge';
import { moduleDisplayName } from '../../elements/moduleDisplayName';
import { useMergePreview } from '../../elements/useMergePreview';
import { useRelationshipTargetSearch } from '../../elements/useRelationshipTargetSearch';
import { mergeReparentEffectSentences, mergeRelationshipEffectSentences } from './mergeEffectSentences';
import { Button } from '../Button/Button';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import styles from './MergeIntoAction.module.css';

export interface MergeIntoTarget {
  elementId: UUID;
  name: string;
}

export interface MergeIntoActionProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  /** Endpoints of `element`'s own live relationships (`ElementPageData.relationshipEndpoints`) — every name the preview can possibly need to show, since the merge only ever touches relationships that already touch `element`. */
  relationshipEndpoints: ReadonlyMap<UUID, ElementsHeadRow>;
  /** `element`'s own children (`ElementPageData.children`) — re-parented onto the survivor by the merge; their names for the preview, same reasoning as `relationshipEndpoints` above. */
  elementChildren: readonly ElementsHeadRow[];
  /** The target picker's own search pool — always main's real head, same reasoning `RetireAction.tsx`'s identical `searchCommitId` doc comment gives. */
  searchCommitId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onMerged: (survivorId: UUID) => void;
  onCancel: () => void;
}

/**
 * E7's own "Merge into…": picks another element of the same type as
 * `element` (this page's own element becomes the loser; the picked one is
 * the survivor — the same "replaced by" direction `RetireAction.tsx`'s own
 * picker already establishes), previews exactly what `useMergePreview`
 * computes from the real engine classification (never a second,
 * hand-written approximation of it — CLAUDE.md rule 7: no stand-in
 * confirmation UI), then commits through `useElementMerge`. A rationale is
 * required: CLAUDE.md rule 4, no fact without provenance — "these are the
 * same real thing" is exactly what `element_merges.rationale` exists to
 * record.
 */
export function MergeIntoAction({
  modelId,
  orgId,
  userId,
  element,
  relationshipEndpoints,
  elementChildren,
  searchCommitId,
  branch,
  expectedHeadCommitId,
  onMerged,
  onCancel,
}: MergeIntoActionProps) {
  const [target, setTarget] = useState<MergeIntoTarget | null>(null);
  const [rationale, setRationale] = useState('');
  const rationaleId = useId();
  const search = useRelationshipTargetSearch(searchCommitId, modelId, [element.element_type], element.element_id, target === null);
  const preview = useMergePreview(modelId, expectedHeadCommitId, target?.elementId ?? null, element.element_id);
  const { status, error, merge } = useElementMerge({
    modelId,
    orgId,
    userId,
    loserId: element.element_id,
    loserName: element.name,
    branch,
    expectedHeadCommitId,
    onMerged,
  });

  const nameOf = (id: UUID): string => {
    if (target?.elementId === id) return target.name;
    if (id === element.element_id) return element.name;
    return relationshipEndpoints.get(id)?.name ?? elementChildren.find((c) => c.element_id === id)?.name ?? id;
  };

  const relationshipSentences = target && preview.effect ? mergeRelationshipEffectSentences(preview.effect, target.name, element.name, nameOf) : [];
  const reparentSentences = target && preview.effect ? mergeReparentEffectSentences(preview.effect, target.name, nameOf) : [];

  return (
    <div className={styles.panel}>
      <Text as="p" size="sm">
        Merge &ldquo;{element.name}&rdquo; into another element? &ldquo;{element.name}&rdquo; is retracted; its relationships and children move to the one you pick below, and its old name stays searchable.
      </Text>

      {target ? (
        <Text as="p" size="sm">
          Merging into <strong>{target.name}</strong>.{' '}
          <Button
            variant="ghost"
            onClick={() => {
              setTarget(null);
            }}
            disabled={status === 'merging'}
          >
            Change
          </Button>
        </Text>
      ) : (
        <div>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- opening this panel is itself the request to search for a merge target.
            autoFocus
            type="text"
            className={styles.input}
            placeholder="Search for the element to merge into…"
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
                      setTarget({ elementId: result.element_id, name: moduleDisplayName(result, search.resultParents.get(result.element_id) ?? null) });
                    }}
                  >
                    <ElementTypeGlyph type={result.element_type} />
                    <Text as="span">{moduleDisplayName(result, search.resultParents.get(result.element_id) ?? null)}</Text>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {target && (
        <>
          {preview.status === 'loading' && (
            <Text as="p" tone="muted" size="sm">
              Checking what this merge would change…
            </Text>
          )}
          {preview.status === 'error' && preview.error && (
            <Text as="p" tone="default" size="sm">
              {preview.error}
            </Text>
          )}
          {preview.status === 'ready' && preview.effect && (
            <>
              <Text as="p" tone="muted" size="sm">
                This will change:
              </Text>
              <ul className={styles.goesList}>
                <li>
                  <Text as="span" size="sm">
                    {element.name} is retracted — its old name stays searchable as an alias of {target.name}.
                  </Text>
                </li>
                {preview.effect.relationships.map((item, i) => (
                  <li key={item.relationshipId}>
                    <Text as="span" size="sm">
                      {relationshipSentences[i]}
                    </Text>
                  </li>
                ))}
                {preview.effect.reparentedChildIds.map((childId, i) => (
                  <li key={childId}>
                    <Text as="span" size="sm">
                      {reparentSentences[i]}
                    </Text>
                  </li>
                ))}
              </ul>
            </>
          )}

          <label htmlFor={rationaleId}>
            <Text as="span" size="sm" tone="muted">
              Why are these the same real thing?
            </Text>
          </label>
          <textarea
            id={rationaleId}
            className={styles.textarea}
            value={rationale}
            onChange={(e) => {
              setRationale(e.target.value);
            }}
            rows={2}
          />
        </>
      )}

      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={() => {
            if (target) void merge(target.elementId, target.name, rationale);
          }}
          disabled={!target || status === 'merging' || rationale.trim() === '' || preview.status === 'loading'}
        >
          {status === 'merging' ? 'Merging…' : 'Merge'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={status === 'merging'}>
          Cancel
        </Button>
      </div>
      {error !== null && (
        <Text as="p" tone="default">
          {error}
        </Text>
      )}
    </div>
  );
}
