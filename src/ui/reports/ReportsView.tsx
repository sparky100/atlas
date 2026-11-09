import { Link } from "react-router";
import { Text } from "../components/Text/Text";
import type { UUID } from "../../contracts/delta";
import { useBoundaryCrossings } from "../boundaryCrossings/useBoundaryCrossings";
import { useDuplicateCheck } from "../duplicates/useDuplicateCheck";
import { useExternalInterfaces } from "../externalInterfaces/useExternalInterfaces";
import { GAP_KINDS, gapItems, gapSummary } from "../gaps/gaps";
import { useIntegrations } from "../integrations/useIntegrations";
import { usePortfolio } from "../portfolio/usePortfolio";
import type { Ref } from "../../db/ref";
import { countLine, type ReportCount } from "./reportCounts";
import styles from "./ReportsView.module.css";

export interface ReportsViewProps {
  modelId: UUID;
  /** Main's current head — the commit the duplicates report reads at (`DuplicatesReportPage.tsx` passes the same). */
  mainHeadCommitId: UUID;
  orgSlug: string;
  modelSlug: string;
}

/**
 * F9 step 3 (UI-principles §2.0): the Reports hub — one row per standing
 * report, each with its current count and a link to the full page. The
 * counts come from the very hooks those pages render from
 * (`useBoundaryCrossings`, `useExternalInterfaces`, `useDuplicateCheck`),
 * so a number here is always exactly what the page behind it lists — no
 * separate count query to drift from it. All three read at main, as their
 * own pages do.
 */
/** Reports read at main, like every report page behind them. */
const MAIN_REF: Ref = { kind: "main" };

export function ReportsView({
  modelId,
  mainHeadCommitId,
  orgSlug,
  modelSlug,
}: ReportsViewProps) {
  const boundary = useBoundaryCrossings(modelId);
  const external = useExternalInterfaces(modelId);
  const duplicates = useDuplicateCheck(modelId, mainHeadCommitId);
  const portfolio = usePortfolio(modelId, MAIN_REF, mainHeadCommitId).state;
  const integrations = useIntegrations(modelId, MAIN_REF, mainHeadCommitId).state;
  const base = `/o/${orgSlug}/m/${modelSlug}`;

  const boundaryCount: ReportCount =
    boundary.status === "ready"
      ? boundary.crossings.length
      : boundary.status === "error"
        ? "error"
        : null;
  const unclassifiedCount: ReportCount =
    external.status === "ready"
      ? external.crossings.length
      : external.status === "error"
        ? "error"
        : null;
  const accessCount: ReportCount =
    external.status === "ready"
      ? external.organisationAccess.length
      : external.status === "error"
        ? "error"
        : null;
  // F12 step 2: the gaps queue's own lines — one per gap that has anything missing.
  const gapLines =
    portfolio.status === "ready"
      ? GAP_KINDS.map((kind) => gapItems(kind, portfolio.data.rows)).flatMap(
          (items, i) =>
            items.length > 0 ? [gapSummary(GAP_KINDS[i] ?? "fit", items)] : [],
        )
      : [countLine(portfolio.status === "error" ? "error" : null, "", "")];
  const duplicatesCount: ReportCount = duplicates.error
    ? "error"
    : duplicates.status === "loading"
      ? null
      : duplicates.candidates.length;

  const integrationsCount: ReportCount =
    integrations.status === "ready"
      ? integrations.data.rows.length
      : integrations.status === "error"
        ? "error"
        : null;

  return (
    <ul className={styles.list}>
      <ReportRow
        title="Integrations"
        description="Every system-to-system link: what connects to what, directly or through a platform or interface."
        counts={[countLine(integrationsCount, "integration", "integrations")]}
        href={`${base}/integrations`}
      />
      <ReportRow
        title="Boundary crossings"
        description="Every uses or flows-to link that crosses the IT/OT boundary."
        counts={[countLine(boundaryCount, "crossing", "crossings")]}
        href={`${base}/boundary-crossings`}
      />
      <ReportRow
        title="External interfaces"
        description="Links that cross the enterprise boundary without a data classification, and the external organisations that use your systems."
        counts={[
          countLine(
            unclassifiedCount,
            "interface missing a data classification",
            "interfaces missing a data classification",
          ),
          countLine(
            accessCount,
            "external organisation with access",
            "external organisations with access",
          ),
        ]}
        attention={
          typeof unclassifiedCount === "number" && unclassifiedCount > 0
        }
        href={`${base}/external-interfaces`}
      />
      <ReportRow
        title="Duplicates"
        description="Elements that look like the same thing recorded twice, from the latest duplicate check."
        counts={[
          countLine(
            duplicatesCount,
            "possible duplicate",
            "possible duplicates",
          ),
        ]}
        attention={typeof duplicatesCount === "number" && duplicatesCount > 0}
        href={`${base}/duplicates`}
      />
      <ReportRow
        title="Gaps"
        description="Systems missing a fit rating, an owner, a run cost, a criticality or a disposition — and a quick way to fill them in."
        counts={gapLines.length > 0 ? gapLines : ["Nothing missing"]}
        attention={gapLines.length > 0 && portfolio.status === "ready"}
        href={`${base}/gaps`}
      />
    </ul>
  );
}

function ReportRow({
  title,
  description,
  counts,
  href,
  attention = false,
}: {
  title: string;
  description: string;
  counts: string[];
  href: string;
  attention?: boolean;
}) {
  return (
    <li className={styles.tileItem}>
      {/* The whole tile is the link; the accessible name stays "Open <title>". */}
      <Link
        to={href}
        className={[styles.tile, attention ? styles.attention : ""].join(" ")}
        aria-label={`Open ${title}`}
      >
        <Text as="h3" size="md">
          {title}
        </Text>
        <Text as="p" tone="muted" size="sm">
          {description}
        </Text>
        <div className={styles.counts}>
          {/* Keyed by position, not text: two lines can read the same thing at once ("Loading…"), and a duplicate key leaves a stale line behind once they diverge. */}
          {counts.map((line, i) => (
            <Text key={i} as="span" size="sm">
              {line}
            </Text>
          ))}
        </div>
        <span className={styles.open} aria-hidden="true">
          Open →
        </span>
      </Link>
    </li>
  );
}
