import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { deleteOrganisation, updateOrganisation, type DeleteOrganisationResult, type UpdateOrganisationInput } from '../../db/organisations';
import type { OrganisationRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type OrganisationSettingsStatus = 'idle' | 'saving';

export interface UseOrganisationSettingsResult {
  status: OrganisationSettingsStatus;
  error: string | null;
  update: (input: UpdateOrganisationInput) => Promise<OrganisationRow | null>;
  /** `null` on a real failure (already reported); the result's own `status` distinguishes 'deleted' from the two refused outcomes ('has_models'/'not_found') a caller shows inline rather than as a global error — same convention as `useModelSettings.ts`'s own `remove`. */
  remove: () => Promise<DeleteOrganisationResult | null>;
}

/**
 * Sprint 7j item 2: organisation settings' rename/Delete — same
 * `run<T>` status/error shape `useModelSettings.ts` already established for
 * a single-purpose write hook. `onChanged` re-fetches the caller's own
 * organisation row rather than this hook keeping its own copy —
 * `OrganisationSettingsView.tsx` already has one from its route.
 */
export function useOrganisationSettings(orgId: UUID, onChanged: (org: OrganisationRow) => void): UseOrganisationSettingsResult {
  const [status, setStatus] = useState<OrganisationSettingsStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(label: string, action: () => Promise<T>, apply: (result: T) => void): Promise<T | null> => {
      setError(null);
      setStatus('saving');
      try {
        const result = await action();
        apply(result);
        setStatus('idle');
        return result;
      } catch (e) {
        setStatus('idle');
        const message = e instanceof Error ? e.message : `Could not ${label}.`;
        setError(message);
        reportError(`Could not ${label}: ${message}`);
        return null;
      }
    },
    [],
  );

  const update = useCallback((input: UpdateOrganisationInput) => run('rename this organisation', () => updateOrganisation(supabase, orgId, input), onChanged), [orgId, onChanged, run]);
  const remove = useCallback(
    () =>
      run(
        'delete this organisation',
        () => deleteOrganisation(supabase, orgId),
        () => {
          // Nothing to re-fetch on success — the organisation itself is
          // gone; a 'has_models'/'not_found' result isn't an organisation
          // to re-apply either, it's shown inline by the caller instead.
        },
      ),
    [orgId, run],
  );

  return { status, error, update, remove };
}
