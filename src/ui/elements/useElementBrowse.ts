import { useEffect, useMemo, useState } from 'react';
import type { ElementType, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { listAllElements, loadOwnersByElementId, lifecycleStatusOf, type BrowseRow } from '../../db/elementBrowse';
import { resolveRef } from '../../db/ref';
import { supabase } from '../supabaseClient';

export type ElementBrowseStatus = 'loading' | 'error' | 'ready';
export type ElementBrowseSortKey = 'name' | 'type' | 'owner' | 'lifecycle';

export type ElementBrowseState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      rows: BrowseRow[];
      typeFilter: ElementType | 'all';
      setTypeFilter: (type: ElementType | 'all') => void;
      query: string;
      setQuery: (query: string) => void;
      sortKey: ElementBrowseSortKey;
      sortDirection: 'asc' | 'desc';
      setSort: (key: ElementBrowseSortKey) => void;
    };

function compareRows(a: BrowseRow, b: BrowseRow, key: ElementBrowseSortKey): number {
  switch (key) {
    case 'name':
      return a.element.name.localeCompare(b.element.name);
    case 'type':
      return a.element.element_type.localeCompare(b.element.element_type) || a.element.name.localeCompare(b.element.name);
    case 'owner':
      return (a.owner?.name ?? '').localeCompare(b.owner?.name ?? '') || a.element.name.localeCompare(b.element.name);
    case 'lifecycle':
      return (a.lifecycleStatus ?? '').localeCompare(b.lifecycleStatus ?? '') || a.element.name.localeCompare(b.element.name);
  }
}

/**
 * The element browse table (Sprint U3b): every element of the model at
 * `main`'s head, filterable by type and a name search, sortable by any
 * column — all client-side over one already-loaded set (this module's own
 * comment in src/db/elementBrowse.ts explains why that's the right shape
 * here, not a live query per filter/sort change).
 */
export function useElementBrowse(modelId: UUID): ElementBrowseState {
  const [status, setStatus] = useState<ElementBrowseStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [allRows, setAllRows] = useState<BrowseRow[]>([]);
  const [typeFilter, setTypeFilter] = useState<ElementType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<ElementBrowseSortKey>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    if (!modelId) return undefined;
    let cancelled = false;
    setStatus('loading');

    async function load(): Promise<void> {
      const commitId = await resolveRef(supabase, modelId, { kind: 'main' });
      if (!commitId) {
        if (!cancelled) {
          setError('This model has no commits yet.');
          setStatus('error');
        }
        return;
      }

      const elements = await listAllElements(supabase, commitId);
      const elementsById = new Map<UUID, ElementsHeadRow>(elements.map((e) => [e.element_id, e]));
      const ownersByElementId = await loadOwnersByElementId(supabase, commitId, elementsById);

      const rows: BrowseRow[] = elements.map((element) => ({
        element,
        owner: ownersByElementId.get(element.element_id) ?? null,
        lifecycleStatus: lifecycleStatusOf(element),
      }));

      if (!cancelled) {
        setAllRows(rows);
        setStatus('ready');
      }
    }

    load().catch((e: unknown) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : 'Failed to load elements.');
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [modelId]);

  const setSort = (key: ElementBrowseSortKey) => {
    if (key === sortKey) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allRows.filter((row) => {
      if (typeFilter !== 'all' && row.element.element_type !== typeFilter) return false;
      if (q === '') return true;
      return row.element.name.toLowerCase().includes(q) || (row.owner?.name.toLowerCase().includes(q) ?? false);
    });
    const sorted = [...filtered].sort((a, b) => compareRows(a, b, sortKey));
    return sortDirection === 'asc' ? sorted : sorted.reverse();
  }, [allRows, typeFilter, query, sortKey, sortDirection]);

  if (status === 'loading') return { status: 'loading' };
  if (status === 'error') return { status: 'error', message: error ?? 'Failed to load elements.' };
  return { status: 'ready', rows, typeFilter, setTypeFilter, query, setQuery, sortKey, sortDirection, setSort };
}
