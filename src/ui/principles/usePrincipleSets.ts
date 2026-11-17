import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { PrincipleSetPayload, PrincipleSetSummary } from '../../contracts/principleSet';
import { addPrinciplesFromSet, listPrincipleSets, publishPrincipleSet, readPrincipleSet } from '../../db/principleSets';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UsePrincipleSetsResult {
  loading: boolean;
  sets: PrincipleSetSummary[];
  /** The principles in the set the person opened, or null until they open one. */
  opened: { set: PrincipleSetSummary; payload: PrincipleSetPayload } | null;
  busy: boolean;
  /** A short, plain-English message about the last action, or null. */
  message: string | null;
  open: (set: PrincipleSetSummary) => Promise<void>;
  close: () => void;
  /** Adds the ticked principles (positions in the opened set) and tells the caller to reload its list. */
  add: (picked: readonly number[]) => Promise<boolean>;
  /** Platform admin only: publishes this model's active principles as the next version of a set. */
  publish: (input: { slug: string; name: string; description: string }) => Promise<boolean>;
}

/** ADR-034 "Starter sets": the published sets, opening one, adding what the person ticks, and (platform admin) publishing. The database (RLS) is the real gate. */
export function usePrincipleSets(modelId: UUID, orgId: UUID, userId: UUID | null, onChanged: () => void): UsePrincipleSetsResult {
  const [loading, setLoading] = useState(true);
  const [sets, setSets] = useState<PrincipleSetSummary[]>([]);
  const [opened, setOpened] = useState<UsePrincipleSetsResult['opened']>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listPrincipleSets(supabase)
      .then((rows) => {
        if (cancelled) return;
        setSets(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoading(false);
        reportError("Couldn't load the starter sets.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const open = useCallback(async (set: PrincipleSetSummary) => {
    setMessage(null);
    setBusy(true);
    try {
      setOpened({ set, payload: await readPrincipleSet(supabase, set.id) });
    } catch (e) {
      setMessage('Could not open this set.');
      reportError('Could not open this set.', e);
    } finally {
      setBusy(false);
    }
  }, []);

  const close = useCallback(() => {
    setOpened(null);
  }, []);

  const add = useCallback(
    async (picked: readonly number[]): Promise<boolean> => {
      if (!opened || !userId) return false;
      setMessage(null);
      setBusy(true);
      try {
        const result = await addPrinciplesFromSet(supabase, { set: opened.set, picked, orgId, modelId, createdBy: userId });
        if (!result.ok) {
          setMessage(result.message);
          return false;
        }
        const skipped = result.alreadyThere.length > 0 ? ` ${String(result.alreadyThere.length)} already in your list, so left alone.` : '';
        setMessage(`Added ${String(result.added)} ${result.added === 1 ? 'principle' : 'principles'} to your list.${skipped}`);
        setOpened(null);
        onChanged();
        return true;
      } catch (e) {
        setMessage('Could not add these principles.');
        reportError('Could not add these principles.', e);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [modelId, onChanged, opened, orgId, userId],
  );

  const publish = useCallback(
    async (input: { slug: string; name: string; description: string }): Promise<boolean> => {
      if (!userId) return false;
      setMessage(null);
      setBusy(true);
      try {
        const result = await publishPrincipleSet(supabase, { modelId, ...input }, userId);
        if (!result.ok) {
          setMessage(result.message);
          return false;
        }
        setMessage(`Published version ${String(result.version)} with ${String(result.principles)} ${result.principles === 1 ? 'principle' : 'principles'}.`);
        setReloadToken((t) => t + 1);
        return true;
      } catch (e) {
        setMessage('Could not publish this set.');
        reportError('Could not publish this set.', e);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [modelId, userId],
  );

  return { loading, sets, opened, busy, message, open, close, add, publish };
}
