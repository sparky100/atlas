/**
 * ADR-027 (F14 step 5): one saved report, run live at main's head, with its
 * downloads, "Save a copy now" (a frozen record of this result — §3), and
 * the copies already taken. Copies are main-only, capped at
 * `REPORT_SNAPSHOT_ROW_CAP` rows and refused (never truncated) beyond it.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { parseReportSpec, type ReportRow, type ReportSpec } from '../../contracts/reportSpec';
import { reportFitsSnapshot, runReport } from '../../engine/reportQuery';
import { createReportSnapshot, listSnapshotsForReport } from '../../db/reports';
import type { MemberRole, ReportSnapshotRow, SavedReportRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { canCreateChangeBranch } from '../orgs/roleGates';
import { supabase } from '../supabaseClient';
import { ReportDownloadButtons } from './ReportDownloadButtons';
import { ReportResultView } from './ReportResultView';
import { ReportRunner } from './ReportRunner';
import { resultToTable } from './reportTable';
import { formatCopyDate, shortCommit } from './copyLabel';
import styles from './SavedReportView.module.css';

export interface SavedReportViewProps {
  report: SavedReportRow;
  modelName: string;
  orgId: UUID;
  modelId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  main: { branchId: UUID; headCommitId: UUID };
  /** `/o/:org/m/:model` */
  basePath: string;
}

export function SavedReportView({ report, modelName, orgId, modelId, userId, role, main, basePath }: SavedReportViewProps) {
  const parsed = useMemo(() => parseReportSpec(report.spec), [report.spec]);
  if (!parsed.ok) {
    return (
      <Text as="p">
        This report can't be run: {parsed.error}
      </Text>
    );
  }
  return (
    <div className={styles.view}>
      {report.description !== '' && (
        <Text as="p" tone="muted">
          {report.description}
        </Text>
      )}
      <Text as="p" size="sm" tone="muted">
        {report.visibility === 'organisation' ? 'Shared with the organisation' : 'Private to you'} · read from main
      </Text>
      <ReportRunner key={main.headCommitId} source={parsed.spec.source} modelId={modelId} orgId={orgId} commitId={main.headCommitId}>
        {(rows, knownFields) => (
          <Loaded report={report} spec={parsed.spec} rows={rows} knownFields={knownFields} modelName={modelName} orgId={orgId} modelId={modelId} userId={userId} role={role} main={main} basePath={basePath} />
        )}
      </ReportRunner>
    </div>
  );
}

function Loaded({ report, spec, rows, knownFields, modelName, orgId, modelId, userId, role, main, basePath }: SavedReportViewProps & { spec: ReportSpec; rows: readonly ReportRow[]; knownFields: readonly string[] }) {
  const result = useMemo(() => runReport(rows, spec, { knownFields }), [rows, spec, knownFields]);
  const table = useMemo(() => resultToTable(result, spec.groupBy === undefined ? undefined : { field: spec.groupBy }), [result, spec.groupBy]);
  const [copies, setCopies] = useState<ReportSnapshotRow[]>([]);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canCopy = userId !== null && canCreateChangeBranch(role);
  const fits = reportFitsSnapshot(result);

  useEffect(() => {
    let cancelled = false;
    listSnapshotsForReport(supabase, report.id)
      .then((list) => {
        if (!cancelled) setCopies(list);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load saved copies.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [report.id, reload]);

  async function saveCopy(): Promise<void> {
    if (userId === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await createReportSnapshot(supabase, {
        id: crypto.randomUUID(),
        orgId,
        modelId,
        reportId: report.id,
        name: report.name,
        spec,
        branchId: main.branchId,
        commitId: main.headCommitId,
        result,
        visibility: report.visibility,
        generatedBy: userId,
      });
      setMessage('Saved a copy. It will not change when the report or the model does.');
      setReload((n) => n + 1);
    } catch (e: unknown) {
      reportError("Couldn't save a copy.", e);
      setMessage(e instanceof Error ? e.message : "Couldn't save a copy.");
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className={styles.actions}>
        <ReportDownloadButtons table={table} fileBase={`${modelName}-${report.name}-${today}`} about={{ report: report.name, model: modelName, state: `main · live, ${today}` }} />
        {canCopy && (
          <Button variant="primary" disabled={busy || !fits} onClick={() => void saveCopy()}>
            Save a copy now
          </Button>
        )}
      </div>
      {!fits && (
        <Text as="p" size="sm" tone="muted">
          This result has more than 5,000 rows, which is too many to keep as a copy. Narrow the report's filter to save one.
        </Text>
      )}
      {message !== null && (
        <Text as="p" size="sm" tone="muted">
          {message}
        </Text>
      )}
      <ReportResultView result={result} spec={spec} />
      <Text as="h2" size="lg">
        Saved copies
      </Text>
      {copies.length === 0 ? (
        <Text as="p" tone="muted">
          No copies yet. A copy keeps this result as it is today.
        </Text>
      ) : (
        <ul className={styles.copies}>
          {copies.map((c) => (
            <li key={c.id}>
              <Link to={`${basePath}/reports/copies/${c.id}`}>
                As at {formatCopyDate(c.generated_at)} · {shortCommit(c.commit_id)}
              </Link>{' '}
              <Text size="sm" tone="muted">
                {c.row_count} {c.row_count === 1 ? 'row' : 'rows'}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
