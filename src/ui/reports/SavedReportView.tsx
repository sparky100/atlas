/**
 * ADR-027 (F14 step 5): one saved report, run live at main's head, with its
 * downloads, "Save a copy now" (a frozen record of this result — §3), and
 * the copies already taken. Copies are main-only, capped at
 * `REPORT_SNAPSHOT_ROW_CAP` rows and refused (never truncated) beyond it.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { parseReportSpec, type ReportRow, type ReportSpec } from '../../contracts/reportSpec';
import { reportFitsSnapshot, runReportWithRows } from '../../engine/reportQuery';
import { createReportSnapshot, listSnapshotsForReport } from '../../db/reports';
import type { MemberRole, ReportSnapshotRow, SavedReportRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { canCreateChangeBranch } from '../orgs/roleGates';
import { supabase } from '../supabaseClient';
import { reportExportPlan } from '../exports/dashboardExport';
import { ReportDownloadButtons } from './ReportDownloadButtons';
import { ReportLoadError } from './ReportLoadError';
import { ReportResultView } from './ReportResultView';
import { ReportRunner } from './ReportRunner';
import { ReportSettings } from './ReportSettings';
import { drilledSpec, drillLabel, drillSearch, parseDrill } from './reportDrill';
import { canEditReport, canShareReport } from './reportAccess';
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
  /** Called with the report as stored after its settings are edited here. */
  onReportChanged?: ((report: SavedReportRow) => void) | undefined;
}

type Copies = { key: string; status: 'error' } | { key: string; status: 'ready'; rows: ReportSnapshotRow[] };

export function SavedReportView({ report, modelName, orgId, modelId, userId, role, main, basePath, onReportChanged }: SavedReportViewProps) {
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
          <Loaded report={report} spec={parsed.spec} rows={rows} knownFields={knownFields} modelName={modelName} orgId={orgId} modelId={modelId} userId={userId} role={role} main={main} basePath={basePath} onReportChanged={onReportChanged} />
        )}
      </ReportRunner>
    </div>
  );
}

function Loaded({ report, spec: savedSpec, rows, knownFields, modelName, orgId, modelId, userId, role, main, basePath, onReportChanged }: SavedReportViewProps & { spec: ReportSpec; rows: readonly ReportRow[]; knownFields: readonly string[] }) {
  // A click-through from a chart (here or on a dashboard) narrows the report to those rows; it lives in the URL only.
  const [searchParams, setSearchParams] = useSearchParams();
  const drills = useMemo(() => parseDrill(searchParams), [searchParams]);
  const drilled = drills.length > 0;
  const spec = useMemo(() => (drilled ? drilledSpec(savedSpec, drills) : savedSpec), [drilled, savedSpec, drills]);
  const { result, displayedRows } = useMemo(() => runReportWithRows(rows, spec, { knownFields }), [rows, spec, knownFields]);
  const table = useMemo(() => resultToTable(result, spec.groupBy === undefined ? undefined : { field: spec.groupBy }), [result, spec.groupBy]);
  const [copies, setCopies] = useState<Copies | null>(null);
  const [reload, setReload] = useState(0);
  const copyKey = `${report.id}:${String(reload)}`;
  const currentCopies = copies?.key === copyKey ? copies : null;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canCopy = userId !== null && canCreateChangeBranch(role);
  const fits = reportFitsSnapshot(result);

  useEffect(() => {
    let cancelled = false;
    listSnapshotsForReport(supabase, report.id)
      .then((list) => {
        if (!cancelled) setCopies({ key: copyKey, status: 'ready', rows: list });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error("Couldn't load saved copies.", e);
        setCopies({ key: copyKey, status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [report.id, copyKey]);

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
        <ReportDownloadButtons
          table={table}
          fileBase={`${modelName}-${report.name}-${today}`}
          about={{ report: report.name, model: modelName, state: `main · live, ${today}` }}
          picture={() => {
            const stamp = { modelName, viewLabel: report.name, refLabel: `Main, live ${today}`, date: today };
            return { plan: reportExportPlan(report.name, spec, result, stamp), stamp };
          }}
        />
        {canCopy && !drilled && (
          <Button variant="primary" disabled={busy || !fits} onClick={() => void saveCopy()}>
            Save a copy now
          </Button>
        )}
      </div>
      {drilled && (
        <div className={styles.drill} role="status">
          <Text size="sm">
            Showing only rows where {drillLabel(drills)}.
          </Text>
          <Button
            variant="ghost"
            onClick={() => {
              setSearchParams(new URLSearchParams());
            }}
          >
            Show the whole report
          </Button>
        </div>
      )}
      {!drilled && canEditReport(report, userId, role) && onReportChanged !== undefined && (
        <ReportSettings key={`${report.id}:${JSON.stringify(report.spec)}`} report={report} spec={savedSpec} knownFields={knownFields} canShare={canShareReport(role)} onSaved={onReportChanged} />
      )}
      {!fits && !drilled && (
        <Text as="p" size="sm" tone="muted">
          This result has more than 5,000 rows, which is too many to keep as a copy. Narrow the report's filter to save one.
        </Text>
      )}
      {message !== null && (
        <Text as="p" size="sm" tone="muted">
          {message}
        </Text>
      )}
      <ReportResultView
        result={result}
        spec={spec}
        live={{ rows: displayedRows, basePath }}
        onDrill={(next) => {
          setSearchParams(new URLSearchParams(drillSearch(next)));
        }}
      />
      <Text as="h2" size="lg">
        Saved copies
      </Text>
      {currentCopies === null && <div role="status"><Text tone="muted">Loading saved copies…</Text></div>}
      {currentCopies?.status === 'error' && <ReportLoadError message="Couldn't load saved copies." retry={() => { setReload((n) => n + 1); }} />}
      {currentCopies?.status === 'ready' && (currentCopies.rows.length === 0 ? (
        <Text as="p" tone="muted">
          No copies yet. A copy keeps this result as it is today.
        </Text>
      ) : (
        <ul className={styles.copies}>
          {currentCopies.rows.map((c) => (
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
      ))}
    </>
  );
}
