import { useId, useState } from 'react';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../../contracts/rows';
import type { UUID } from '../../../contracts/delta';
import type { BranchRow } from '../../../db/types';
import { attributesRecord } from '../../elements/attributesRecord';
import { buildReplaceWithNewElementDeltas } from '../../elements/buildReplaceWithNewElementDeltas';
import { moduleDisplayName } from '../../elements/moduleDisplayName';
import { useElementRetire, type RetireReplacement } from '../../elements/useElementRetire';
import { useRelationshipTargetSearch } from '../../elements/useRelationshipTargetSearch';
import { useReplaceWithNewElement } from '../../elements/useReplaceWithNewElement';
import { Button } from '../Button/Button';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import styles from './RetireAction.module.css';

export interface RetireActionProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  relationships: readonly RelationshipsHeadRow[];
  relationshipFacts: ReadonlyMap<UUID, Map<string, FactsRow>>;
  /** The "replaced by" picker's own search pool — always main's real head, same reasoning `ElementSearchAdd.tsx`/`RelationshipAdd.tsx` already give. */
  searchCommitId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onRetired: () => void;
  /** A brand-new replacement was created in the same commit (`buildReplaceWithNewElementDeltas.ts`'s own doc comment explains the gap this closes) — the caller almost certainly wants to navigate there, the same way `useElementCreate.ts`'s own `onCreated` already does, rather than reloading in place the way plain `onRetired` does (A itself is still here, just retiring — nothing to navigate away from for that case). */
  onReplacedWithNew: (newElementId: UUID) => void;
  onCancel: () => void;
}

/**
 * Prompt 7k item 5's "Retire…" — planned end date (required: that's the
 * whole point of retiring something), plus an optional "replaced by"
 * search picker (scoped to `element`'s own type — a system replaces with
 * another system, a module/container with another container, "platforms
 * and modules" own generalisation — excluding this element itself) whose
 * capability transfer is `useElementRetire`'s own job. See that hook's
 * doc comment for what the transfer does and doesn't attempt.
 *
 * A third mode, "+ Create new instead…", covers the case that picker can
 * never reach: a replacement that doesn't exist yet at all. Its own search
 * always reads main's real head (`src/db/elementSearch.ts`'s own module
 * comment) — nothing you create in the *same* unmerged change is ever
 * findable there. `useReplaceWithNewElement.ts`/`buildReplaceWithNewElementDeltas.ts`
 * close that gap by creating the replacement and transferring A's own
 * edges onto it in one commit, never searching for it at all.
 */
export function RetireAction({
  modelId,
  orgId,
  userId,
  element,
  facts,
  relationships,
  relationshipFacts,
  searchCommitId,
  branch,
  expectedHeadCommitId,
  onRetired,
  onReplacedWithNew,
  onCancel,
}: RetireActionProps) {
  const currentPlannedEnd = attributesRecord(element.attributes).plannedEnd;
  const [plannedEnd, setPlannedEnd] = useState(typeof currentPlannedEnd === 'string' ? currentPlannedEnd : '');
  const [replacement, setReplacement] = useState<RetireReplacement | null>(null);
  // 'none': nothing chosen yet, both options offered. 'searching': the
  // existing-element picker. 'creating': the new "doesn't exist yet" mode.
  const [mode, setMode] = useState<'none' | 'searching' | 'creating'>('none');
  const [newReplacementName, setNewReplacementName] = useState('');
  const plannedEndId = useId();
  const newNameId = useId();
  const search = useRelationshipTargetSearch(searchCommitId, modelId, [element.element_type], element.element_id, mode === 'searching');
  const searchPlaceholder = element.element_type === 'container' ? 'Search modules…' : 'Search systems…';
  const { status, error, retire } = useElementRetire({
    modelId,
    orgId,
    userId,
    element,
    facts,
    relationships,
    relationshipFacts,
    branch,
    expectedHeadCommitId,
    onRetired,
  });
  const { status: replaceStatus, error: replaceError, replace } = useReplaceWithNewElement({
    modelId,
    orgId,
    userId,
    element,
    facts,
    relationships,
    relationshipFacts,
    branch,
    expectedHeadCommitId,
    onReplaced: onReplacedWithNew,
  });
  const busy = status === 'retiring' || replaceStatus === 'replacing';
  // A cheap, real preview — never a hand-summarised approximation
  // (CLAUDE.md rule 7) — computed by calling the same pure builder the
  // actual commit uses, with a placeholder name/date that never leaves
  // this component; only the counts are shown.
  const previewCounts =
    mode === 'creating' && newReplacementName.trim() !== ''
      ? (() => {
          const { deltas } = buildReplaceWithNewElementDeltas({
            element,
            facts,
            relationships,
            relationshipFacts,
            plannedEnd: plannedEnd.trim() === '' ? '2099-01-01' : plannedEnd,
            replacementName: newReplacementName.trim(),
            sourceId: 'preview',
            onMain: branch.kind === 'main',
          });
          const supportsCount = deltas.filter((d) => d.kind === 'relationship.create' && (d as unknown as { relationshipType: string }).relationshipType === 'supports').length;
          const otherCount = deltas.filter((d) => d.kind === 'relationship.create').length - supportsCount;
          return { supportsCount, otherCount };
        })()
      : null;

  return (
    <div className={styles.panel}>
      <Text as="p" size="sm">
        Retire &ldquo;{element.name}&rdquo;? This sets its lifecycle to retiring and records a planned end date.
      </Text>
      <label htmlFor={plannedEndId}>
        <Text as="span" size="sm" tone="muted">
          Planned end
        </Text>
      </label>
      <input
        id={plannedEndId}
        type="date"
        className={styles.input}
        value={plannedEnd}
        onChange={(e) => {
          setPlannedEnd(e.target.value);
        }}
      />

      {replacement ? (
        <Text as="p" size="sm">
          Replaced by <strong>{replacement.name}</strong> — the capabilities it supports transfer to the replacement.{' '}
          <Button
            variant="ghost"
            onClick={() => {
              setReplacement(null);
            }}
            disabled={busy}
          >
            Change
          </Button>
        </Text>
      ) : mode === 'searching' ? (
        <div>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- opening this picker is itself the request to type a search.
            autoFocus
            type="text"
            className={styles.input}
            placeholder={searchPlaceholder}
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
                      setReplacement({ elementId: result.element_id, name: moduleDisplayName(result, search.resultParents.get(result.element_id) ?? null) });
                      setMode('none');
                    }}
                  >
                    <ElementTypeGlyph type={result.element_type} />
                    <Text as="span">{moduleDisplayName(result, search.resultParents.get(result.element_id) ?? null)}</Text>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Text as="p" tone="faint" size="xs">
            Doesn&apos;t exist yet?{' '}
            <Button
              variant="ghost"
              onClick={() => {
                setMode('creating');
              }}
            >
              Create new instead
            </Button>
          </Text>
          <Button
            variant="ghost"
            onClick={() => {
              setMode('none');
            }}
          >
            Cancel search
          </Button>
        </div>
      ) : mode === 'creating' ? (
        <div className={styles.creating}>
          <label htmlFor={newNameId}>
            <Text as="span" size="sm" tone="muted">
              {element.element_type === 'container' ? 'New module name' : 'New system name'}
            </Text>
          </label>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- opening this mode is itself the request to type a name.
            autoFocus
            id={newNameId}
            type="text"
            className={styles.input}
            value={newReplacementName}
            onChange={(e) => {
              setNewReplacementName(e.target.value);
            }}
          />
          {previewCounts && (
            <Text as="p" tone="faint" size="xs">
              This will create <strong>{newReplacementName.trim()}</strong>
              {previewCounts.supportsCount > 0 ? `, transfer ${String(previewCounts.supportsCount)} supports edge${previewCounts.supportsCount === 1 ? '' : 's'}` : ''}
              {previewCounts.otherCount > 0 ? `, ${String(previewCounts.otherCount)} uses/flows_to edge${previewCounts.otherCount === 1 ? '' : 's'}` : ''}, and retire &ldquo;{element.name}&rdquo;.
            </Text>
          )}
          <div className={styles.actions}>
            <Button
              variant="ghost"
              onClick={() => {
                setMode('none');
                setNewReplacementName('');
              }}
              disabled={busy}
            >
              Cancel create
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={() => {
              setMode('searching');
            }}
          >
            + Replaced by…
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setMode('creating');
            }}
          >
            + Create new instead…
          </Button>
        </div>
      )}

      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={() => (mode === 'creating' ? void replace(plannedEnd, newReplacementName) : void retire(plannedEnd, replacement))}
          disabled={busy || plannedEnd.trim() === '' || (mode === 'creating' && newReplacementName.trim() === '')}
        >
          {busy ? 'Retiring…' : 'Retire'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      {(error ?? replaceError) !== null && (
        <Text as="p" tone="default">
          {error ?? replaceError}
        </Text>
      )}
    </div>
  );
}
