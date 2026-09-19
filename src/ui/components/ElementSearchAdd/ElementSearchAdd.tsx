import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ElementType, UUID } from '../../../contracts/delta';
import type { BranchRow } from '../../../db/types';
import { useElementCreate } from '../../elements/useElementCreate';
import { useElementSearchAdd } from '../../elements/useElementSearchAdd';
import { moduleDisplayName } from '../../elements/moduleDisplayName';
import { Button } from '../Button/Button';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import styles from './ElementSearchAdd.module.css';

export interface ElementSearchAddProps {
  elementType: ElementType;
  /** Closed-state button text, e.g. "+ Add system". */
  buttonLabel: string;
  /** Structural parent for the created element (ADR-001) — null for a top-level system/actor, the system/container id otherwise. */
  parentId: UUID | null;
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** The commit this control searches against — always main's real head (src/db/elementSearch.ts's own module comment explains why, regardless of `branch`/`expectedHeadCommitId` below). */
  searchCommitId: UUID;
  /** Where the create commits (Blocking: element creation — "main for architects/owners; the selected branch otherwise"): the caller's own `useEditingBranch`/`canEditBranch` result, same as ElementPage.tsx. */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  orgSlug: string;
  modelSlug: string;
  refParam: string;
  /** Called after a successful create, in addition to opening the new element's page — e.g. a page that also wants to reload its own list. */
  onCreated?: () => void;
}

/**
 * The search-first "Add" control — rule 1 of ADR-019's identity policy
 * (search before creating, always; a caught duplicate is resolved by a
 * reversible `atlas.merge_elements`, never a delete; what search alone
 * misses is Q1's own duplicates report to catch, not this control's job).
 * Type a name; existing matches (by name, alias, or description —
 * src/db/elementSearch.ts) show with their owner and relationship count.
 * Prompt 7h bug fix: "Create …" is always the last row unless there's an
 * exact, case-insensitive match on a name or alias (`useElementSearchAdd.ts`'s
 * `showCreate`) — a near-match alone never hides it, it only means both
 * show together. Clicking an existing match just opens it — a
 * search-first control's whole point is finding out something already
 * exists rather than creating a duplicate. Clicking "Create" adds it via
 * `commit_deltas` (`useElementCreate`) and opens the new element's page.
 */
export function ElementSearchAdd({
  elementType,
  buttonLabel,
  parentId,
  modelId,
  orgId,
  userId,
  searchCommitId,
  branch,
  expectedHeadCommitId,
  orgSlug,
  modelSlug,
  refParam,
  onCreated,
}: ElementSearchAddProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const search = useElementSearchAdd(searchCommitId, modelId, elementType);
  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}?ref=${refParam}`;

  const { status: createStatus, error: createError, create } = useElementCreate({
    modelId,
    orgId,
    userId,
    elementType,
    parentId,
    branch,
    expectedHeadCommitId,
    onCreated: (elementId) => {
      setOpen(false);
      onCreated?.();
      void navigate(elementHref(elementId));
    },
  });

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => { setOpen(true); }}>
        {buttonLabel}
      </Button>
    );
  }

  return (
    <div className={styles.panel}>
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opening this control is itself the user's request to type a name; a search box that doesn't focus itself is the broken affordance here.
        autoFocus
        type="text"
        className={styles.input}
        placeholder={`Search or create a ${elementType}…`}
        value={search.query}
        onChange={(e) => { search.setQuery(e.target.value); }}
      />

      {search.status === 'loading' && (
        <Text as="p" tone="muted" size="sm">
          Loading…
        </Text>
      )}
      {search.status === 'error' && (
        <Text as="p" size="sm">
          {search.error}
        </Text>
      )}

      {search.results.length > 0 && (
        <ul className={styles.results}>
          {search.results.map((result) => (
            <li key={result.element.element_id}>
              <Link to={elementHref(result.element.element_id)} className={styles.resultRow}>
                <ElementTypeGlyph type={result.element.element_type} />
                <Text as="span">{moduleDisplayName(result.element, result.parent)}</Text>
                {result.owner && (
                  <Text as="span" tone="muted" size="sm">
                    owned by {result.owner.name}
                  </Text>
                )}
                <Text as="span" tone="faint" size="sm">
                  {result.relationshipCount} relationship{result.relationshipCount === 1 ? '' : 's'}
                </Text>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {search.moreCount > 0 && (
        <Text as="p" tone="muted" size="sm">
          {search.results.length} shown — {search.moreCount} more match{search.moreCount === 1 ? '' : 'es'}. Keep typing to narrow before creating a new one.
        </Text>
      )}

      {search.showCreate && (
        <Button variant="primary" disabled={createStatus === 'creating'} onClick={() => void create(search.query)}>
          {createStatus === 'creating' ? 'Adding…' : `Create ${elementType} "${search.query.trim()}"`}
        </Button>
      )}

      <div className={styles.actions}>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>

      {createError !== null && (
        <Text as="p" size="sm">
          {createError}
        </Text>
      )}
    </div>
  );
}
