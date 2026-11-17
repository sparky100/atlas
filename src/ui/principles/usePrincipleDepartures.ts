import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { listDecisionsForModel } from '../../db/decisions';
import { listDepartureLinks } from '../../db/principles';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { countDecisionsDeparting } from './decisionPrinciples';

/** How many of this model's decisions depart from a principle (cancelled ones excluded); `null` until read, and left `null` if the read fails (the line is then simply not shown). */
export function usePrincipleDepartures(modelId: UUID): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([listDepartureLinks(supabase), listDecisionsForModel(supabase, modelId)])
      .then(([links, decisions]) => {
        if (!cancelled) setCount(countDecisionsDeparting(links, decisions));
      })
      .catch((e: unknown) => {
        reportError("Couldn't count the decisions that depart from a principle.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);
  return count;
}
