import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ElementType, UUID } from '../../contracts/delta';
import type { BranchRow } from '../../db/types';
import { useElementCreate } from '../elements/useElementCreate';
import { Button } from '../components/Button/Button';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import { HOME_SEARCH_CREATABLE_TYPES, useHomeSearch } from './useHomeSearch';
import styles from './HomeSearch.module.css';

export interface HomeSearchProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  searchCommitId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  orgSlug: string;
  modelSlug: string;
  /** Called after a successful create, in addition to navigating to the new element's page — e.g. the caller's own `useMainBranch` reload (Sprint U4-1 A1: `searchCommitId` above only stays valid for future searches if the page refreshes it once its commit lands). */
  onCreated?: () => void;
}

/**
 * Both front doors' search box (UI-principles §3 + U3b: "a search box
 * (search-first) that opens or creates an element"). Always open — unlike
 * `ElementSearchAdd` (a per-page "+ Add", closed until clicked), this *is*
 * the front door's own content, not an auxiliary control tucked behind a
 * button. Searches every top-level-creatable type at once
 * (`useHomeSearch.ts`); once nothing matches, picking a type is what
 * `ElementSearchAdd` doesn't need (it's always fixed to one type by the
 * page it's on) and this control does, since a home-page search has no
 * such fixed context.
 */
export function HomeSearch({ modelId, orgId, userId, searchCommitId, branch, expectedHeadCommitId, orgSlug, modelSlug, onCreated }: HomeSearchProps) {
  const navigate = useNavigate();
  const search = useHomeSearch(searchCommitId, modelId);
  const [createType, setCreateType] = useState<ElementType>('system');
  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}?ref=main`;

  const { status: createStatus, error: createError, create } = useElementCreate({
    modelId,
    orgId,
    userId,
    elementType: createType,
    parentId: null,
    branch,
    expectedHeadCommitId,
    onCreated: (elementId) => {
      onCreated?.();
      void navigate(elementHref(elementId));
    },
  });

  return (
    <div className={styles.panel}>
      <input
        type="text"
        className={styles.input}
        placeholder="Search or create a capability, system, or actor…"
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
            <li key={result.element_id}>
              <Link to={elementHref(result.element_id)} className={styles.resultRow}>
                <ElementTypeGlyph type={result.element_type} />
                <Text as="span">{result.name}</Text>
                <Text as="span" tone="muted" size="sm">
                  {result.element_type}
                </Text>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {search.showCreate && (
        <div className={styles.createRow}>
          <select className={styles.select} value={createType} onChange={(e) => { setCreateType(e.target.value as ElementType); }}>
            {HOME_SEARCH_CREATABLE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <Button variant="primary" disabled={createStatus === 'creating'} onClick={() => void create(search.query)}>
            {createStatus === 'creating' ? 'Adding…' : `Create ${createType} "${search.query.trim()}"`}
          </Button>
        </div>
      )}

      {createError !== null && (
        <Text as="p" size="sm">
          {createError}
        </Text>
      )}
    </div>
  );
}
