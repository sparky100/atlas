import { useParams } from "react-router";
import { AppHeader } from "../components/AppHeader/AppHeader";
import { Breadcrumb } from "../components/Breadcrumb/Breadcrumb";
import { EditingBranchBanner } from "../branches/EditingBranchBanner/EditingBranchBanner";
import { ModelNav } from "../components/ModelNav/ModelNav";
import navStyles from "../components/ModelNav/ModelNav.module.css";
import { Text } from "../components/Text/Text";
import { useMainBranch } from "../branches/useMainBranch";
import { useSelectedRef } from "../branches/useSelectedRef";
import { useModels } from "../models/useModels";
import { useOrganisationBySlug } from "../orgs/useOrganisationBySlug";
import { ReportsView } from "../reports/ReportsView";
import { DashboardsList } from "../reports/DashboardsList";
import { SavedReportsLibrary } from "../reports/SavedReportsLibrary";
import { useAuth } from "../auth/useAuth";
import { useMembership } from "../orgs/useMembership";
import reportStyles from "../reports/SavedReportsLibrary.module.css";
import styles from "./ViewPage.module.css";

/** F9 step 3 (UI-principles §2.0): the Reports hub (`/reports`) — the Analyse group's way into the model's standing reports, which had no nav entry before. Mirrors `BoundaryCrossingsPage.tsx`'s own shape. */
export function ReportsPage() {
  const { orgSlug, modelSlug } = useParams<{
    orgSlug: string;
    modelSlug: string;
  }>();
  const { ref } = useSelectedRef();
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(
    orgSlug ?? "",
  );
  const { models, loading: modelsLoading } = useModels(
    organisation?.id ?? null,
  );
  const model = models.find((m) => m.slug === modelSlug);
  const { branch: mainBranch, loading: mainLoading } = useMainBranch(
    model?.id ?? null,
  );
  const { role } = useMembership(organisation?.id ?? null, userId);

  if (orgLoading || modelsLoading || mainLoading || !model || !mainBranch) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ""} modelSlug={modelSlug ?? ""} />
          <main className={styles.main}>
            <Text tone="muted">Loading…</Text>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ""} modelSlug={modelSlug ?? ""} />
        <main className={styles.main}>
          <EditingBranchBanner
            activeRef={ref}
            modelId={model.id}
            orgSlug={orgSlug ?? ""}
            modelSlug={model.slug}
            showModeShortcuts={false}
          />
          <Breadcrumb
            org={{
              label: organisation?.name ?? "",
              href: `/o/${orgSlug ?? ""}`,
            }}
            model={{
              label: model.name,
              href: `/o/${orgSlug ?? ""}/m/${model.slug}`,
            }}
            refLabel="Reports"
          />
          <div className={styles.header}>
            <Text as="h1" size="2xl">
              Reports
            </Text>
            <Text as="p" tone="muted">
              Dashboards, saved reports and standing checks across the live
              model.
            </Text>
          </div>
          {organisation && (
            <DashboardsList
              modelId={model.id}
              orgId={organisation.id}
              userId={userId}
              role={role}
              basePath={`/o/${orgSlug ?? ""}/m/${model.slug}`}
            />
          )}
          {organisation && (
            <SavedReportsLibrary
              modelId={model.id}
              orgId={organisation.id}
              userId={userId}
              role={role}
              basePath={`/o/${orgSlug ?? ""}/m/${model.slug}`}
            />
          )}
          <section className={reportStyles.section}>
            <Text as="h2" size="lg">
              Standing checks
            </Text>
            <ReportsView
              modelId={model.id}
              mainHeadCommitId={mainBranch.head_commit_id}
              orgSlug={orgSlug ?? ""}
              modelSlug={model.slug}
            />
          </section>
        </main>
      </div>
    </div>
  );
}
