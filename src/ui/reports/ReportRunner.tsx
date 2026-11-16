/**
 * ADR-027 (F14 step 5): loads the rows a saved report's source needs, at
 * main's head, and hands them (with the field list) to its child. One small
 * component per source so each calls only the hook it needs.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ReportSource } from '../../contracts/reportSpec';
import type { Ref } from '../../db/ref';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useAttributeDefinitions } from '../orgs/useAttributeDefinitions';
import { usePortfolio } from '../portfolio/usePortfolio';
import { supabase } from '../supabaseClient';
import { ELEMENT_REPORT_FIELDS, ELEMENT_REPORT_HELPER_FIELDS, ELEMENT_REPORT_OPTIONAL_FIELDS } from './elementsReport';
import { loadElementReportRows } from './loadElementReportRows';
import { PORTFOLIO_REPORT_FIELDS, PORTFOLIO_REPORT_HELPER_FIELDS, PORTFOLIO_REPORT_OPTIONAL_FIELDS, portfolioReportRow } from './portfolioReport';
import { ReportLoadError } from './ReportLoadError';
import { FINDING_REPORT_FIELDS, loadFindingReportRows, loadRelationshipReportRows, RELATIONSHIP_REPORT_FIELDS } from './relationshipAndFindingReports';
import { withReportLinks, type LiveReportRow } from './reportRowLinks';

const MAIN_REF: Ref = { kind: 'main' };

export interface ReportRunnerProps {
  source: ReportSource;
  modelId: UUID;
  orgId: UUID;
  /** Main's head: the commit every row is read at. */
  commitId: UUID;
  children: (rows: readonly LiveReportRow[], knownFields: readonly string[]) => ReactNode;
}

export function ReportRunner(props: ReportRunnerProps) {
  const [attempt, setAttempt] = useState(0);
  const key = `${props.orgId}:${props.modelId}:${props.commitId}:${String(attempt)}`;
  const retry = () => { setAttempt((n) => n + 1); };
  if (props.source === 'elements') return <ElementsRunner key={key} {...props} retry={retry} />;
  if (props.source === 'portfolio') return <PortfolioRunner key={key} {...props} retry={retry} />;
  return <ModelReportRunner key={`${key}:${props.source}`} {...props} source={props.source} retry={retry} />;
}

type RunnerProps = ReportRunnerProps & { retry: () => void };
type ReportLoad = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: LiveReportRow[] };

function ElementsRunner({ orgId, commitId, children, retry }: RunnerProps) {
  const { userId } = useAuth();
  const { definitions, loading: definitionsLoading, error: definitionsError } = useAttributeDefinitions(orgId, userId);
  const [state, setState] = useState<ReportLoad>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    loadElementReportRows(supabase, commitId)
      .then((rows) => {
        if (!cancelled) setState({ status: 'ready', rows });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error("Couldn't load element report data.", e);
        setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [commitId]);
  const known = useMemo(() => [...ELEMENT_REPORT_FIELDS, ...ELEMENT_REPORT_OPTIONAL_FIELDS, ...ELEMENT_REPORT_HELPER_FIELDS, ...definitions.filter((d) => d.deprecated_at === null).map((d) => d.key)], [definitions]);
  if (state.status === 'error' || definitionsError !== null) return <ReportLoadError message="Couldn't load element report data." retry={retry} />;
  if (state.status === 'loading' || definitionsLoading) return <div role="status"><Text tone="muted">Loading element report data…</Text></div>;
  return <>{children(state.rows, known)}</>;
}

function PortfolioRunner({ modelId, commitId, children, retry }: RunnerProps) {
  const { state } = usePortfolio(modelId, MAIN_REF, commitId, { inlineErrors: true });
  const rows = useMemo(() => (state.status === 'ready' ? state.data.rows.map((row) => withReportLinks(portfolioReportRow(row), {
    name: { elementId: row.element.element_id },
    ...(row.businessOwner === null ? {} : { owner: { elementId: row.businessOwner.element_id } }),
  })) : []), [state]);
  const known = useMemo(() => [...PORTFOLIO_REPORT_FIELDS, ...PORTFOLIO_REPORT_OPTIONAL_FIELDS, ...PORTFOLIO_REPORT_HELPER_FIELDS], []);
  if (state.status === 'loading') return <div role="status"><Text tone="muted">Loading portfolio report data…</Text></div>;
  if (state.status !== 'ready') return <ReportLoadError message="Couldn't load portfolio report data." retry={retry} />;
  return <>{children(rows, known)}</>;
}

function ModelReportRunner({ source, commitId, children, retry }: RunnerProps & { source: 'relationships' | 'findings' }) {
  const [state, setState] = useState<ReportLoad>({ status: 'loading' });
  const load = source === 'relationships' ? loadRelationshipReportRows : loadFindingReportRows;
  const fields = source === 'relationships' ? RELATIONSHIP_REPORT_FIELDS : FINDING_REPORT_FIELDS;
  const label = source === 'relationships' ? 'relationships' : 'findings';
  useEffect(() => {
    let cancelled = false;
    void load(supabase, commitId).then((rows) => {
      if (!cancelled) setState({ status: 'ready', rows });
    }).catch((error: unknown) => {
      if (cancelled) return;
      console.error(`Couldn't load ${label}.`, error);
      setState({ status: 'error' });
    });
    return () => { cancelled = true; };
  }, [commitId, label, load]);
  if (state.status === 'loading') return <div role="status"><Text tone="muted">Loading {label}…</Text></div>;
  if (state.status === 'error') return <ReportLoadError message={`Couldn't load ${label}.`} retry={retry} />;
  return <>{children(state.rows, fields)}</>;
}
