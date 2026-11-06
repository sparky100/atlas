import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { getDashboard } from '../../db/reports';
import type { DashboardRow } from '../../db/types';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useMainBranch } from '../branches/useMainBranch';
import { reportError } from '../errors/errorBannerStore';
import { useModels } from '../models/useModels';
import { useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { DashboardView } from '../reports/DashboardView';
import { supabase } from '../supabaseClient';
import styles from './ViewPage.module.css';

type Loaded = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; dashboard: DashboardRow };

/** ADR-027 (F14 step 6b): one dashboard (`/reports/dashboards/:id`), under the Reports hub. Same chrome as `SavedReportPage.tsx`. */
export function DashboardPage() {
  const { orgSlug, modelSlug, id } = useParams<{ orgSlug: string; modelSlug: string; id: string }>();
  const { userId } = useAuth();
  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { branch: mainBranch, loading: mainLoading } = useMainBranch(model?.id ?? null);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const [state, setState] = useState<Loaded>({ status: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    getDashboard(supabase, id)
      .then((d) => {
        if (!cancelled) setState(d ? { status: 'ready', dashboard: d } : { status: 'missing' });
      })
      .catch((e: unknown) => {
        reportError("Couldn't open the dashboard.", e);
        if (!cancelled) setState({ status: 'missing' });
      });
    return () => {
      cancelled = true;
    };
  }, [id, reload]);

  const chrome = (title: string, body: React.ReactNode) => (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
          {model && <Breadcrumb org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }} model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }} refLabel="Reports" />}
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              {title}
            </Text>
          </div>
          {body}
        </main>
      </div>
    </div>
  );

  if (orgLoading || modelsLoading || mainLoading || !model || !mainBranch || !organisation) return chrome('Dashboard', <Text tone="muted">Loading…</Text>);
  if (state.status === 'loading') return chrome('Dashboard', <Text tone="muted">Loading…</Text>);
  if (state.status === 'missing') return chrome('Dashboard', <Text as="p">This dashboard doesn't exist, or you can't see it.</Text>);
  return chrome(
    state.dashboard.name,
    <DashboardView
      key={state.dashboard.id}
      dashboard={state.dashboard}
      orgId={organisation.id}
      modelId={model.id}
      userId={userId}
      role={role}
      main={{ headCommitId: mainBranch.head_commit_id }}
      basePath={`/o/${orgSlug ?? ''}/m/${model.slug}`}
      onChanged={() => {
        setReload((n) => n + 1);
      }}
    />,
  );
}
