import { useEffect, useState } from 'react';
import { restReadActivity } from '../limitedFetch';
import { useAfterFirstPaint } from './useAfterFirstPaint';

/**
 * Like `useAfterFirstPaint`, but also waits until the page's own reads have
 * finished (`restReadActivity.whenQuiet`, with a ceiling so a slow page still
 * shows them). For small, non-critical numbers that are not part of any
 * page's content — the menu's notification, decision, review and open-change
 * counts — so their requests never join the burst that opens the database's
 * cold connections.
 */
export function useAfterPageData(): boolean {
  const afterFirstPaint = useAfterFirstPaint();
  const [quiet, setQuiet] = useState(false);

  useEffect(() => {
    if (!afterFirstPaint) return undefined;
    let cancelled = false;
    void restReadActivity.whenQuiet().then(() => {
      if (!cancelled) setQuiet(true);
    });
    return () => {
      cancelled = true;
    };
  }, [afterFirstPaint]);

  return quiet;
}
