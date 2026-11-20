import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { citationIds, citationsToNames } from '../../db/designAgent';
import { getElementsByIds } from '../../db/elements';
import { supabase } from '../supabaseClient';

/** At most this many cited elements are looked up, so the lookup stays small (CLAUDE.md rule 8). */
const MAX_IDS = 50;

/**
 * Text saved before the Designer's element citations were turned into names may still hold
 * `[[element:<id>]]`. A person must never see an id, so this reads the names when the text is shown.
 * Text with no citation renders as it is, with no lookup.
 */
export function ElementNamedText({ text, commitId }: { text: string; commitId: UUID | null }) {
  const ids = citationIds(text).slice(0, MAX_IDS);
  const { data } = useQuery({
    queryKey: ['elementNamedText', commitId, ids],
    enabled: commitId !== null && ids.length > 0,
    queryFn: async () => {
      if (commitId === null) return {};
      const rows = await getElementsByIds(supabase, commitId, ids);
      return Object.fromEntries([...rows.values()].map((e) => [e.element_id, e.name]));
    },
  });
  // Until the names arrive (or if they cannot be read) the id is still replaced, never shown.
  return <>{citationsToNames(text, data ?? {})}</>;
}
