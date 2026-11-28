import { useCallback, useState } from 'react';

/**
 * What the sections of one page know: how many are waiting in each (null until
 * that block has loaded) and which are open. Once every count is known the first
 * block with something waiting opens, unless the person has already opened or
 * closed one. `ready` says the counts are all in, so a test or a person is not
 * looking at a page that is still settling.
 */
export function useReviewSections(ids: readonly string[], options: { openFirst?: string } = {}) {
  const [counts, setCounts] = useState<Record<string, number | null>>(() => Object.fromEntries(ids.map((id) => [id, null])));
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const countsKnown = ids.every((id) => counts[id] !== null && counts[id] !== undefined);
  const ready = ids.length === 0 || countsKnown;
  const firstWaiting = options.openFirst ?? ids.find((id) => (counts[id] ?? 0) > 0);
  const isOpen = (id: string): boolean => opened[id] ?? (ready && firstWaiting === id);
  const setCount = useCallback((id: string, count: number) => {
    setCounts((current) => (current[id] === count ? current : { ...current, [id]: count }));
  }, []);
  const toggle = useCallback((id: string, open: boolean) => {
    setOpened((current) => (current[id] === open ? current : { ...current, [id]: open }));
  }, []);
  /** Open one block and bring it into view (used by the counts at the top of the page). */
  const jumpTo = useCallback((id: string) => {
    setOpened((current) => ({ ...current, [id]: true }));
    window.setTimeout(() => {
      document.querySelector(`[data-testid="section-${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, []);
  return { counts, ready, isOpen, setCount, toggle, jumpTo };
}
