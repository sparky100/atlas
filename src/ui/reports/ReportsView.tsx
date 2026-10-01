import { LinkButton } from '../components/Button/LinkButton';
import { Text } from '../components/Text/Text';
import type { UUID } from '../../contracts/delta';
import { useBoundaryCrossings } from '../boundaryCrossings/useBoundaryCrossings';
import { useDuplicateCheck } from '../duplicates/useDuplicateCheck';
import { useExternalInterfaces } from '../externalInterfaces/useExternalInterfaces';
import { countLine, type ReportCount } from './reportCounts';
import styles from './ReportsView.module.css';

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
export function ReportsView({ modelId, mainHeadCommitId, orgSlug, modelSlug }: ReportsViewProps) {
  const boundary = useBoundaryCrossings(modelId);
  const external = useExternalInterfaces(modelId);
  const duplicates = useDuplicateCheck(modelId, mainHeadCommitId);
  const base = `/o/${orgSlug}/m/${modelSlug}`;

  const boundaryCount: ReportCount = boundary.status === 'ready' ? boundary.crossings.length : boundary.status === 'error' ? 'error' : null;
  const unclassifiedCount: ReportCount = external.status === 'ready' ? external.crossings.length : external.status === 'error' ? 'error' : null;
  const accessCount: ReportCount = external.status === 'ready' ? external.organisationAccess.length : external.status === 'error' ? 'error' : null;
  const duplicatesCount: ReportCount = duplicates.error ? 'error' : duplicates.status === 'loading' ? null : duplicates.candidates.length;

  return (
    <ul className={styles.list}>
      <ReportRow
        title="Boundary crossings"
        description="Every uses or flows-to link that crosses the IT/OT boundary."
        counts={[countLine(boundaryCount, 'crossing', 'crossings')]}
        href={`${base}/boundary-crossings`}
      />
      <ReportRow
        title="External interfaces"
        description="Links that cross the enterprise boundary without a data classification, and the external organisations that use your systems."
        counts={[countLine(unclassifiedCount, 'interface missing a data classification', 'interfaces missing a data classification'), countLine(accessCount, 'external organisation with access', 'external organisations with access')]}
        href={`${base}/external-interfaces`}
      />
      <ReportRow
        title="Duplicates"
        description="Elements that look like the same thing recorded twice, from the latest duplicate check."
        counts={[countLine(duplicatesCount, 'possible duplicate', 'possible duplicates')]}
        href={`${base}/duplicates`}
      />
    </ul>
  );
}

function ReportRow({ title, description, counts, href }: { title: string; description: string; counts: string[]; href: string }) {
  return (
    <li className={styles.row}>
      <div className={styles.text}>
        <Text as="h2" size="lg">
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
      </div>
      <LinkButton to={href} variant="secondary" aria-label={`Open ${title}`}>
        Open →
      </LinkButton>
    </li>
  );
}
