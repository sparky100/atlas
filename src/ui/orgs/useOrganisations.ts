import { useCallback, useEffect, useState } from 'react';
import { createOrganisation, listOrganisationsForUser } from '../../db/organisations';
import type { OrganisationRow } from '../../db/types';
import { useAuth } from '../auth/useAuth';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseOrganisationsResult {
  organisations: OrganisationRow[];
  loading: boolean;
  error: string | null;
  /** Re-fetches the list — call after creating an organisation. */
  refresh: () => void;
  createOrganisation: (name: string, slug: string, createdBy: string, isPersonal?: boolean) => Promise<OrganisationRow>;
}

/** Organisations the signed-in user belongs to (RLS scopes the query — see organisations.ts's module comment). */
export function useOrganisations(): UseOrganisationsResult {
  const [organisations, setOrganisations] = useState<OrganisationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  // A background invite consumption can add a membership after this first loads.
  const { membershipsGeneration } = useAuth();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listOrganisationsForUser(supabase)
      .then((rows) => {
        if (!cancelled) setOrganisations(rows);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load your organisations.", e);
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load organisations');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [generation, membershipsGeneration]);

  const refresh = useCallback(() => {
    setGeneration((g) => g + 1);
  }, []);

  const create = useCallback(async (name: string, slug: string, createdBy: string, isPersonal = false) => {
    const org = await createOrganisation(supabase, { id: crypto.randomUUID(), name, slug, createdBy, isPersonal });
    setOrganisations((prev) => [...prev, org].sort((a, b) => a.name.localeCompare(b.name)));
    return org;
  }, []);

  return { organisations, loading, error, refresh, createOrganisation: create };
}
