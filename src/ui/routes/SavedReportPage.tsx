import { Loading } from '../components/Loading/Loading';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { ReportSnapshotRow, SavedReportRow } from '../../db/types';
import { getReportSnapshot, getSavedReport } from '../../db/reports';
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
import { SavedCopyView } from '../reports/SavedCopyView';
import { SavedReportView } from '../reports/SavedReportView';
import { copyLabel } from '../reports/copyLabel';
import { supabase } from '../supabaseClient';
import styles from './ViewPage.module.css';

type Loaded<T> = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; value: T };

/**
 * ADR-027 (F14 step 5): a saved report (`/reports/saved/:id`) or an opened
 * saved copy (`/reports/copies/:id`), under the Reports hub. Same chrome as
 * `ReportsPage.tsx`.
 */
export function SavedReportPage({ kind }: { kind: 'report' | 'copy' }) {
  const { orgSlug, modelSlug, id } = useParams<{ orgSlug: string; modelSlug: string; id: string }>();
  const { userId } = useAuth();
  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { branch: mainBranch, loading: mainLoading } = useMainBranch(model?.id ?? null);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const [report, setReport] = useState<Loaded<SavedReportRow>>({ status: 'loading' });
  const [copy, setCopy] = useState<Loaded<ReportSnapshotRow>>({ status: 'loading' });

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    const load = kind === 'report' ? getSavedReport(supabase, id).then((r) => (r ? { status: 'ready' as const, value: r } : { status: 'missing' as const })) : null;
    if (load) {
      load
        .then((r) => {
          if (!cancelled) setReport(r);
        })
        .catch((e: unknown) => {
          reportError("Couldn't open the report.", e);
          if (!cancelled) setReport({ status: 'missing' });
        });
    } else {
      getReportSnapshot(supabase, id)
        .then((c) => {
          if (!cancelled) setCopy(c ? { status: 'ready', value: c } : { status: 'missing' });
        })
        .catch((e: unknown) => {
          reportError("Couldn't open the saved copy.", e);
          if (!cancelled) setCopy({ status: 'missing' });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [id, kind]);

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

  if (orgLoading || modelsLoading || mainLoading || !model || !mainBranch || !organisation) return chrome('Report', <Loading />);
  const basePath = `/o/${orgSlug ?? ''}/m/${model.slug}`;

  if (kind === 'report') {
    if (report.status === 'loading') return chrome('Report', <Loading />);
    if (report.status === 'missing') return chrome('Report', <Text as="p">This report doesn't exist, or you can't see it.</Text>);
    return chrome(
      report.value.name,
      <SavedReportView report={report.value} modelName={model.name} orgId={organisation.id} modelId={model.id} userId={userId} role={role} main={{ branchId: mainBranch.id, headCommitId: mainBranch.head_commit_id }} basePath={basePath} onReportChanged={(next) => { setReport({ status: 'ready', value: next }); }} />,
    );
  }
  if (copy.status === 'loading') return chrome('Saved copy', <Loading />);
  if (copy.status === 'missing') return chrome('Saved copy', <Text as="p">This copy doesn't exist, or you can't see it.</Text>);
  return chrome(`${copy.value.name} (${copyLabel(copy.value.generated_at, copy.value.commit_id)})`, <SavedCopyView copy={copy.value} modelName={model.name} userId={userId} role={role} basePath={basePath} />);
}
