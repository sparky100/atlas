import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { refLabelOf, refQueryParam } from '../../db/ref';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useEditingBranch } from '../branches/useEditingBranch';
import { useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { isViewingMode } from '../branches/viewingMode';
import { commitBulkEdit, commitRelationshipAttribute } from '../elements/bulkEdit';
import { GapWalk, type GapWalkSaver } from '../gaps/GapWalk';
import { GapsOverview } from '../gaps/GapsOverview';
import { gapItems, gapSummary, isGapKind, type GapItem, type GapKind } from '../gaps/gaps';
import { useModels } from '../models/useModels';
import { canEditBranch } from '../orgs/roleGates';
import { useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { usePortfolio } from '../portfolio/usePortfolio';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';
import styles from './ViewPage.module.css';

/**
 * F12 step 2: the gaps queue (`/gaps`, reached from the Reports hub) — how
 * many systems are missing each Portfolio input, and `?kind=` walks one
 * gap's items with the keyboard. Reads the selected ref and writes where
 * the element page's own Edit would (the selected draft change, or main),
 * behind the same gate (`canEditBranch`); anyone else sees the counts only.
 */
export function GapsPage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const viewing = isViewingMode(searchParams);
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const { branch: mainBranch } = useMainBranch(model?.id ?? null);
  const { branch: editingBranch } = useEditingBranch(model?.id ?? null, ref);
  const { label: branchLabel } = useBranchLabel(ref);
  const writeBranch = editingBranch ?? (ref.kind === 'main' ? mainBranch : null);
  const canFill = !viewing && writeBranch !== null && canEditBranch(role, writeBranch);

  const { state, reload } = usePortfolio(model?.id ?? '', ref, mainBranch?.head_commit_id ?? null);

  const kindParam = searchParams.get('kind');
  const kind: GapKind | null = isGapKind(kindParam) ? kindParam : null;

  // The walk's items are taken once, when it opens: a refresh after each
  // save (for the counts) must not reshuffle the list being walked.
  const [walk, setWalk] = useState<{ kind: GapKind; items: GapItem[] } | null>(null);
  // Adjusted during render (React's own "storing information from previous
  // renders" pattern), not in an effect.
  if (kind === null && walk !== null) setWalk(null);
  if (kind !== null && state.status === 'ready' && walk?.kind !== kind) setWalk({ kind, items: gapItems(kind, state.data.rows) });

  const saver = useMemo<GapWalkSaver | null>(() => {
    if (!model || !organisation || !userId || !writeBranch || !canFill) return null;
    const base = { modelId: model.id, orgId: organisation.id, userId, branch: writeBranch, expectedHeadCommitId: writeBranch.head_commit_id };
    const finish = (result: Awaited<ReturnType<typeof commitBulkEdit>> | Awaited<ReturnType<typeof commitRelationshipAttribute>>): string | null => {
      if (!result.ok) {
        if (result.reason === 'validation') return 'errors' in result ? [...result.errors.values()].join(' ') : result.message;
        return result.reason === 'conflict' ? 'The model changed since this page loaded. Reload and try again.' : `Could not save: ${result.message}`;
      }
      if (result.commitId !== null) applyCommitToCache(queryClient, model.id, writeBranch, result.commitId, result.newHead);
      return null;
    };
    return {
      saveAttribute: async (item, key, value) =>
        finish(await commitBulkEdit(supabase, { ...base, cells: [{ elementId: item.element.element_id, key, draft: value }], elementsById: new Map([[item.element.element_id, item.element]]), customFields: new Map() })),
      saveFit: async (item, value) => {
        if (!item.link) return 'This capability link is no longer in the model.';
        return finish(await commitRelationshipAttribute(supabase, { ...base, relationship: item.link.relationship, label: `${item.name} → ${item.link.capabilityName}`, key: 'fitForPurpose', draft: value }));
      },
    };
  }, [model, organisation, userId, writeBranch, canFill, queryClient]);

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Text tone="muted">Loading…</Text>
          </main>
        </div>
      </div>
    );
  }

  const base = `/o/${orgSlug ?? ''}/m/${model.slug}`;
  const refParam = refQueryParam(ref, viewing);
  const gapsHref = `${base}/gaps?${refParam}`;
  const walkHref = (k: GapKind) => `${base}/gaps?${refParam}&kind=${k}`;
  const elementHref = (elementId: string) => `${base}/e/${elementId}?${refParam}`;

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />
          <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: base }} refLabel={refLabelOf(ref, branchLabel)} />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Gaps
            </Text>
            <Text as="p" tone="muted">
              {walk ? gapSummary(walk.kind, walk.items) : 'What’s missing from the model, and a quick way to fill it in.'}
            </Text>
          </div>

          {walk && saver && writeBranch ? (
            <GapWalk
              key={walk.kind}
              kind={walk.kind}
              items={walk.items}
              saver={saver}
              owner={{ modelId: model.id, orgId: organisation?.id ?? '', userId, branch: writeBranch, searchCommitId: writeBranch.head_commit_id }}
              elementHref={elementHref}
              backHref={gapsHref}
              onFilled={reload}
            />
          ) : (
            <>
              {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
              {state.status === 'error' && <Text as="p">{state.message}</Text>}
              {state.status === 'refNotFound' && <Text as="p">Nothing here yet.</Text>}
              {state.status === 'ready' && <GapsOverview rows={state.data.rows} walkHref={walkHref} canFill={canFill} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
