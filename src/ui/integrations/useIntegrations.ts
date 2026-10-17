/**
 * The Integrations page's own data load: every system, module/interface
 * and actor at this ref, and every `uses`/`flows_to` link between them —
 * the same "resolve the ref once, fetch the model's own scope, derive
 * client-side" shape `usePortfolio.ts` uses (no per-row query, no id list
 * in a request — CLAUDE.md rule 8).
 */
import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { listActorsForLandscape, listContainersForLandscape, listLandscapeEdges, listSystemsForLandscape } from '../../db/landscape';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { buildIntegrationRows, type IntegrationRow } from './integrationRows';

export interface IntegrationsData {
  commitId: UUID;
  rows: IntegrationRow[];
}

export type IntegrationsState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'refNotFound' } | { status: 'ready'; data: IntegrationsData };

export function useIntegrations(modelId: UUID, ref: Ref, mainCommitIdHint: UUID | null = null): { state: IntegrationsState } {
  const [state, setState] = useState<IntegrationsState>({ status: 'loading' });
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!modelId) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const commitId = ref.kind === 'main' && mainCommitIdHint ? mainCommitIdHint : await resolveRef(supabase, modelId, ref);
      if (!commitId) {
        if (!cancelled) setState({ status: 'refNotFound' });
        return;
      }
      const [systems, containers, actors] = await Promise.all([listSystemsForLandscape(supabase, commitId), listContainersForLandscape(supabase, commitId), listActorsForLandscape(supabase, commitId)]);
      const elements: ElementsHeadRow[] = [...systems, ...containers, ...actors];
      const links = await listLandscapeEdges(supabase, commitId, [...systems, ...containers].map((e) => e.element_id), actors.map((a) => a.element_id));
      const rows = buildIntegrationRows(links, new Map(elements.map((e) => [e.element_id, e])));
      if (!cancelled) setState({ status: 'ready', data: { commitId, rows } });
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load the integrations.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the integrations.' });
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, refParam, mainCommitIdHint]);

  return { state };
}
