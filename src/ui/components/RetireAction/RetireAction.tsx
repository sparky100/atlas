import { useId, useState } from 'react';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../../contracts/rows';
import type { UUID } from '../../../contracts/delta';
import type { BranchRow } from '../../../db/types';
import { attributesRecord } from '../../elements/attributesRecord';
import { buildReplaceWithNewElementDeltas } from '../../elements/buildReplaceWithNewElementDeltas';
import { moduleDisplayName } from '../../elements/moduleDisplayName';
import { listCopyableEdges } from '../../elements/replacementEdges';
import { useElementRetire, type RetireReplacement } from '../../elements/useElementRetire';
import { SYSTEM_OR_MODULE_TYPES, useRelationshipTargetSearch } from '../../elements/useRelationshipTargetSearch';
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
  /** The elements at the other end of `relationships`, to name each link in the copy list (`ElementPageData.relationshipEndpoints`). */
  relationshipEndpoints: ReadonlyMap<UUID, ElementsHeadRow>;
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
  relationshipEndpoints,
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
  // Links left unticked are not copied to the replacement. Everything is ticked by default.
  const [unticked, setUnticked] = useState<ReadonlySet<UUID>>(new Set());
  const plannedEndId = useId();
  const newNameId = useId();
  // A replacement named in the same change as the retire itself (real
  // capture review: "SAP Datasphere," added moments earlier on this same
  // branch, as SAP BW's own replacement) is otherwise invisible to a
  // main-only search — `useRelationshipTargetSearch`'s own `branchCommitId`
  // doc comment.
  // Systems and modules both: a replacement can be a module inside a platform
  // (shown as "Module (in Platform)"). `replaces` and `supports` both allow
  // system and container ends (`relationshipTypeRules.ts`).
  const search = useRelationshipTargetSearch(searchCommitId, modelId, SYSTEM_OR_MODULE_TYPES, element.element_id, mode === 'searching', branch.kind === 'change' ? branch.head_commit_id : null);
  const searchPlaceholder = 'Search systems and modules…';
  const { status, error, retire } = useElementRetire({
    modelId,
    orgId,
    userId,
    element,
    facts,
    relationships,
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
    branch,
    expectedHeadCommitId,
    onReplaced: onReplacedWithNew,
  });
  const copyable = listCopyableEdges(element.element_id, relationships, (id) => relationshipEndpoints.get(id)?.name).filter((e) => e.otherId !== replacement?.elementId);
  const copyEdgeIds: ReadonlySet<UUID> = new Set(copyable.filter((e) => !unticked.has(e.relationshipId)).map((e) => e.relationshipId));
  const copyList =
    copyable.length === 0 ? null : (
      <fieldset className={styles.copyList} data-testid="replacement-copy-list">
        <legend>
          <Text as="span" size="sm" tone="muted">
            Copy these links to the replacement
          </Text>
        </legend>
        {copyable.map((e) => (
          <label key={e.relationshipId} className={styles.copyRow}>
            <input
              type="checkbox"
              checked={!unticked.has(e.relationshipId)}
              onChange={(ev) => {
                const next = new Set(unticked);
                if (ev.target.checked) next.delete(e.relationshipId);
                else next.add(e.relationshipId);
                setUnticked(next);
              }}
            />
            <Text as="span" size="sm">
              {e.label}
              {e.kind === 'interface' && (
                <Text as="span" size="xs" tone="faint">
                  {' '}
                  — to confirm: does the replacement connect this way?
                </Text>
              )}
            </Text>
          </label>
        ))}
        <Text as="p" tone="faint" size="xs">
          Copies only: &ldquo;{element.name}&rdquo; keeps its own links until it is retired.
        </Text>
      </fieldset>
    );
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
            plannedEnd: plannedEnd.trim() === '' ? '2099-01-01' : plannedEnd,
            replacementName: newReplacementName.trim(),
            copyEdgeIds,
            sourceId: 'preview',
            onMain: branch.kind === 'main',
          });
          const copiedCount = deltas.filter((d) => d.kind === 'relationship.create' && (d as unknown as { relationshipType: string }).relationshipType !== 'replaces').length;
          return { copiedCount };
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
        <>
        <Text as="p" size="sm">
          Replaced by <strong>{replacement.name}</strong> — the links ticked below are copied to the replacement, and the old ones stop counting after its planned end date.{' '}
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
        {copyList}
        </>
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
          {copyList}
          {previewCounts && (
            <Text as="p" tone="faint" size="xs">
              This will create <strong>{newReplacementName.trim()}</strong>
              {previewCounts.copiedCount > 0 ? `, copy ${String(previewCounts.copiedCount)} ${previewCounts.copiedCount === 1 ? 'link' : 'links'} to it` : ''}, and retire &ldquo;{element.name}&rdquo;. Ownership and other links stay on &ldquo;{element.name}&rdquo; for you to review.
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
          onClick={() => (mode === 'creating' ? void replace(plannedEnd, newReplacementName, copyEdgeIds) : void retire(plannedEnd, replacement, copyEdgeIds))}
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
