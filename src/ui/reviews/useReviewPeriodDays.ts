import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getReviewPeriodDays } from '../../db/organisations';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/** The organisation's review period in days, or `null` while it loads (or if it could not be read — nothing is then flagged overdue, rather than guessing a period). */
export function useReviewPeriodDays(orgId: UUID): number | null {
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    getReviewPeriodDays(supabase, orgId)
      .then((d) => {
        if (!cancelled) setDays(d);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load the review period.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);
  return days;
}
