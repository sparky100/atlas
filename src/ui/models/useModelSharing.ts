import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { createModelShare, listShareTargetOrgNames, listSharesForModel, resolveOrganisationForSharing, revokeModelShare } from '../../db/modelShares';
import type { ModelShareRow, TagRow } from '../../db/types';
import { listTagsForModel } from '../../db/tags';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/** `create`'s own richer result — the two ways sharing can be refused that a caller shows inline rather than as a global error, same convention `useInvites.ts`'s own `create` established. */
export type CreateModelShareResult = { status: 'created'; share: ModelShareRow } | { status: 'org_not_found' } | { status: 'already_shared' };

export interface UseModelSharingResult {
  shares: ModelShareRow[];
  tags: TagRow[];
  /** Share-target org name, keyed by `shared_with_org_id` — `listShareTargetOrgNames`'s own map, for the management list. */
  orgNames: Map<UUID, string>;
  loading: boolean;
  error: string | null;
  /** `null` on a real failure (already reported); the result's own `status` distinguishes 'created'/'org_not_found'/'already_shared'. */
  create: (targetOrgSlug: string, tagId: UUID | null) => Promise<CreateModelShareResult | null>;
  revoke: (id: UUID) => Promise<void>;
}

/**
 * F7 item 4: `ModelSettingsView`'s "Share with another organisation" panel
 * — the owner's own management view of a model's shares, plus the tag list
 * for the optional "pin to a version" picker. Same reload-after-mutation
 * shape `useInvites.ts` already established.
 */
export function useModelSharing(modelId: UUID | null, createdBy: UUID | null): UseModelSharingResult {
  const [shares, setShares] = useState<ModelShareRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [orgNames, setOrgNames] = useState<Map<UUID, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!modelId) {
      setShares([]);
      setTags([]);
      setOrgNames(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([listSharesForModel(supabase, modelId), listTagsForModel(supabase, modelId), listShareTargetOrgNames(supabase, modelId)])
      .then(([shareRows, tagRows, names]) => {
        if (cancelled) return;
        setShares(shareRows);
        setTags(tagRows);
        setOrgNames(names);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load shares');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // reloadToken is a deliberate refetch trigger, not a value the effect
    // reads — the react-hooks plugin only runs on .tsx files (eslint.config.js).
  }, [modelId, reloadToken]);

  const create = async (targetOrgSlug: string, tagId: UUID | null): Promise<CreateModelShareResult | null> => {
    if (!modelId || !createdBy) return null;
    setError(null);
    try {
      const resolved = await resolveOrganisationForSharing(supabase, targetOrgSlug);
      if (resolved.status === 'not_found') return { status: 'org_not_found' };
      if (shares.some((s) => s.shared_with_org_id === resolved.orgId && s.tag_id === tagId)) return { status: 'already_shared' };
      const share = await createModelShare(supabase, {
        id: crypto.randomUUID(),
        modelId,
        tagId,
        sharedWithOrgId: resolved.orgId,
        createdBy,
      });
      setReloadToken((t) => t + 1);
      return { status: 'created', share };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not share this model.';
      setError(message);
      reportError('Could not share this model.', e);
      return null;
    }
  };

  const revoke = async (id: UUID) => {
    setError(null);
    try {
      await revokeModelShare(supabase, id);
      setReloadToken((t) => t + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not revoke this share.';
      setError(message);
      reportError('Could not revoke this share.', e);
    }
  };

  return { shares, tags, orgNames, loading, error, create, revoke };
}
