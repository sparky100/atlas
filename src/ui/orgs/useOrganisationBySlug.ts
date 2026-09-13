import { useEffect, useState } from 'react';
import { getOrganisationBySlug } from '../../db/organisations';
import type { OrganisationRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseOrganisationBySlugResult {
  organisation: OrganisationRow | null;
  loading: boolean;
  error: string | null;
}

export function useOrganisationBySlug(slug: string): UseOrganisationBySlugResult {
  const [organisation, setOrganisation] = useState<OrganisationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getOrganisationBySlug(supabase, slug)
      .then((org) => {
        if (!cancelled) setOrganisation(org);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load this organisation.", e);
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load organisation');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { organisation, loading, error };
}
