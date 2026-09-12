import { useEffect } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { BranchStatus } from '../../db/types';
import type { Ref } from '../../db/ref';
import { supabase } from '../supabaseClient';

/** The literal shape of a row in `branches` — just the one column this hook reacts to, not the full `BranchRow` contracts/rows.ts already types for the write path (same convention `src/db/realtime.ts`'s own `CommitNotification` uses). */
interface BranchStatusRow {
  id: string;
  status: BranchStatus;
}

/**
 * Sticky ref close-out: "any transition that makes the branch non-editable
 * for the current user resets the active ref to main on every open tab
 * (realtime)." Submitting for review already clears the *submitting* tab's
 * own selection (`ChangeView.tsx`'s own comment) — this is the other half,
 * for every *other* open tab (this browser, another window, a second
 * device signed into the same account) that still has the same branch
 * selected when it stops being editable: approved, merged, or rejected
 * elsewhere, or submitted from a different tab than the one currently
 * looking at it.
 *
 * Scope, deliberately narrow: only a transition *away from* `draft`
 * matters here — `canEditBranch`'s own rule (roleGates.ts) is "a change
 * branch takes commits only while `status === 'draft'`," so anything else
 * is "no longer editable for anyone," not specific to one user's role.
 * `atlas.request_changes`'s own reverse transition (back to `draft`) needs
 * no reaction here — a branch becoming editable again is never a reason to
 * evict anyone from a ref they may not even have.
 *
 * One row, one subscription: filtered directly on `branches.id`
 * (`id=eq.<branchId>`), not a per-model channel like
 * `src/db/realtime.ts`'s own `subscribeToModelChannel` — this only ever
 * cares about the one branch currently selected, and doesn't have a
 * resolved `modelId` to key a model-wide channel on anyway
 * (`SelectedRefProvider.tsx`'s own storage key is org/model *slugs*, not
 * ids). No reconnect/backoff machinery: missing one event here means the
 * session keeps pointing at a branch it can no longer write to until the
 * next explicit exit (`Back to main`/submit) — a page trying to write
 * still gets a real, visible RLS rejection either way
 * (`canEditBranch`/`atlas.commit_deltas`'s own gate), never a silent
 * success, so a missed reset is a UX rough edge, not a correctness gap.
 */
export function useBranchStatusReset(ref: Ref, clearRef: () => void): void {
  const branchId = ref.kind === 'branch' ? ref.branchId : null;

  useEffect(() => {
    if (!branchId) return undefined;
    const channel = supabase
      .channel(`branch-status:${branchId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'branches', filter: `id=eq.${branchId}` }, (payload: RealtimePostgresChangesPayload<BranchStatusRow>) => {
        if (payload.eventType === 'UPDATE' && payload.new.status !== 'draft') clearRef();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [branchId, clearRef]);
}
