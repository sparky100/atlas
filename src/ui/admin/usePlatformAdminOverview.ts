import { useEffect, useState } from 'react';
import { listPlatformAdminOrganisations, listPlatformAdminPeople } from '../../db/platformAdminOverview';
import type { PlatformAdminOrganisation, PlatformAdminPerson } from '../../contracts/platformAdmin';
import { supabase } from '../supabaseClient';

export type PlatformAdminOverviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; organisations: PlatformAdminOrganisation[]; people: PlatformAdminPerson[] };

/** Loads both lists once. The database refuses anyone who is not a platform admin; this hook only shows what comes back. */
export function usePlatformAdminOverview(): PlatformAdminOverviewState {
  const [state, setState] = useState<PlatformAdminOverviewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listPlatformAdminOrganisations(supabase), listPlatformAdminPeople(supabase)]).then(([orgs, people]) => {
      if (cancelled) return;
      if (orgs.status === 'error') setState({ status: 'error', message: orgs.message });
      else if (people.status === 'error') setState({ status: 'error', message: people.message });
      else setState({ status: 'ready', organisations: orgs.rows, people: people.rows });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
