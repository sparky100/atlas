/**
 * ADR-027 (F14 step 5): an opened saved copy. Reads only the stored row —
 * never the live model — so it shows, exports and prints exactly what was
 * reported, "as at <date>, <commit>". Deleting one is allowed to its creator
 * (or an owner/architect for a shared copy) behind a confirmation that says
 * it cannot be undone.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { parseReportSpec } from '../../contracts/reportSpec';
import { deleteReportSnapshot, reportResultOfSnapshot } from '../../db/reports';
import type { MemberRole, ReportSnapshotRow } from '../../db/types';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { copyLabel } from './copyLabel';
import { reportExportPlan } from '../exports/dashboardExport';
import { ReportDownloadButtons } from './ReportDownloadButtons';
import { ReportResultView } from './ReportResultView';
import { resultToTable } from './reportTable';
import styles from './SavedReportView.module.css';

export interface SavedCopyViewProps {
  copy: ReportSnapshotRow;
  modelName: string;
  userId: UUID | null;
  role: MemberRole | null;
  basePath: string;
}

export function SavedCopyView({ copy, modelName, userId, role, basePath }: SavedCopyViewProps) {
  const navigate = useNavigate();
  const parsed = useMemo(() => parseReportSpec(copy.spec), [copy.spec]);
  const result = useMemo(() => reportResultOfSnapshot(copy), [copy]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = copyLabel(copy.generated_at, copy.commit_id);
  const canDelete = userId !== null && (copy.generated_by === userId || (copy.visibility === 'organisation' && (role === 'owner' || role === 'architect')));

  if (!parsed.ok) return <Text as="p">This copy's definition can't be read: {parsed.error}</Text>;
  const table = resultToTable(result, parsed.spec.groupBy === undefined ? undefined : { field: parsed.spec.groupBy });

  async function remove(): Promise<void> {
    try {
      await deleteReportSnapshot(supabase, copy.id);
      void navigate(`${basePath}/reports`);
    } catch (e: unknown) {
      reportError("Couldn't delete the copy.", e);
      setError(e instanceof Error ? e.message : "Couldn't delete the copy.");
    }
  }

  return (
    <div className={styles.view}>
      <Text as="p" tone="muted">
        Saved copy, {label}. This is a record of what the report said then; it does not change.
      </Text>
      <div className={styles.actions}>
        <ReportDownloadButtons
          table={table}
          fileBase={`${modelName}-${copy.name}-${copy.generated_at.slice(0, 10)}`}
          about={{ report: copy.name, model: modelName, state: `live model · ${label}`, extra: [['Commit', copy.commit_id]] }}
          picture={() => {
            const stamp = { modelName, viewLabel: copy.name, refLabel: `Saved copy, ${label}`, date: copy.generated_at.slice(0, 10) };
            return { plan: reportExportPlan(copy.name, parsed.spec, result, stamp), stamp };
          }}
        />
        {canDelete && !confirming && (
          <Button
            variant="destructive"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete this copy…
          </Button>
        )}
        {canDelete && confirming && (
          <>
            <Text size="sm">Delete this copy? This cannot be undone.</Text>
            <Button variant="destructive" onClick={() => void remove()}>
              Yes, delete it
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep it
            </Button>
          </>
        )}
      </div>
      {error !== null && <Text as="p">{error}</Text>}
      <ReportResultView result={result} spec={parsed.spec} />
    </div>
  );
}
