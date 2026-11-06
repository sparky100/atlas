/**
 * ADR-027 (F14 step 5): loads the rows a saved report's source needs, at
 * main's head, and hands them (with the field list) to its child. One small
 * component per source so each calls only the hook it needs. Only `elements`
 * and `portfolio` have adapters so far; any other source says so plainly
 * (rule 7: absent and said so, not faked).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ReportRow, ReportSource } from '../../contracts/reportSpec';
import type { Ref } from '../../db/ref';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { useAuth } from '../auth/useAuth';
import { useAttributeDefinitions } from '../orgs/useAttributeDefinitions';
import { usePortfolio } from '../portfolio/usePortfolio';
import { supabase } from '../supabaseClient';
import { ELEMENT_REPORT_FIELDS, ELEMENT_REPORT_HELPER_FIELDS } from './elementsReport';
import { loadElementReportRows } from './loadElementReportRows';
import { PORTFOLIO_REPORT_FIELDS, PORTFOLIO_REPORT_HELPER_FIELDS, portfolioReportRow } from './portfolioReport';

const MAIN_REF: Ref = { kind: 'main' };

export interface ReportRunnerProps {
  source: ReportSource;
  modelId: UUID;
  orgId: UUID;
  /** Main's head: the commit every row is read at. */
  commitId: UUID;
  children: (rows: readonly ReportRow[], knownFields: readonly string[]) => ReactNode;
}

export function ReportRunner(props: ReportRunnerProps) {
  if (props.source === 'elements') return <ElementsRunner {...props} />;
  if (props.source === 'portfolio') return <PortfolioRunner {...props} />;
  return <Text as="p">Reports about {props.source} are not available yet.</Text>;
}

function ElementsRunner({ orgId, commitId, children }: ReportRunnerProps) {
  const { userId } = useAuth();
  const { definitions } = useAttributeDefinitions(orgId, userId);
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: ReportRow[] }>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    loadElementReportRows(supabase, commitId)
      .then((rows) => {
        if (!cancelled) setState({ status: 'ready', rows });
      })
      .catch((e: unknown) => {
        reportError("Couldn't load the report's data.", e);
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [commitId]);
  const known = useMemo(() => [...ELEMENT_REPORT_FIELDS, ...ELEMENT_REPORT_HELPER_FIELDS, ...definitions.filter((d) => d.deprecated_at === null).map((d) => d.key)], [definitions]);
  if (state.status === 'loading') return <Text tone="muted">Running…</Text>;
  if (state.status === 'error') return <Text as="p">Couldn't run this report.</Text>;
  return <>{children(state.rows, known)}</>;
}

function PortfolioRunner({ modelId, commitId, children }: ReportRunnerProps) {
  const { state } = usePortfolio(modelId, MAIN_REF, commitId);
  const rows = useMemo(() => (state.status === 'ready' ? state.data.rows.map(portfolioReportRow) : []), [state]);
  const known = useMemo(() => [...PORTFOLIO_REPORT_FIELDS, ...PORTFOLIO_REPORT_HELPER_FIELDS], []);
  if (state.status === 'loading') return <Text tone="muted">Running…</Text>;
  if (state.status !== 'ready') return <Text as="p">Couldn't run this report.</Text>;
  return <>{children(rows, known)}</>;
}
