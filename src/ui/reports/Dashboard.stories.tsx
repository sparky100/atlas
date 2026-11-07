import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import { REPORT_SPEC_VERSION, type ReportRow, type ReportSpec } from '../../contracts/reportSpec';
import type { DashboardTileKind, DashboardTileRow, DashboardTileSize, SavedReportRow } from '../../db/types';
import { runReport } from '../../engine/reportQuery';
import { DashboardTileCard } from './DashboardTileCard';
import { ReportResultView } from './ReportResultView';
import { STANDARD_DASHBOARDS } from './standardDashboards';
import { tileColumnSpan } from './dashboardTiles';
import styles from './Dashboard.module.css';

/*
 * Visual review only: a dashboard of every tile kind over a realistic
 * fixture portfolio, so the tiles can be looked at (light/dark, 1280/390)
 * without a database. Story content, never reachable from the app (rule 7).
 */

const NAMES = [
  'Active Network Management (ANM) Portal', 'ADMS', 'ADQM', 'ArcGIS', 'Aurora', 'Azure Synapse', 'Connections Portal', 'CRM (Dynamics 365)', 'DataHub', 'DMS Mobile',
  'Ellipse', 'Enterprise Service Bus', 'Flexibility Hub', 'GE PowerOn', 'Grid Analytics', 'HR (Workday)', 'IFS Field Service', 'Identity (Entra ID)', 'Load Forecasting', 'LV Monitoring',
  'Maximo', 'Meter Data Hub', 'MuleSoft', 'Network Model (CIM)', 'Outage Comms', 'PI Historian', 'Power BI', 'Procurement (Ariba)', 'SAP ECC', 'SAP PM',
  'SAP FI', 'SCADA', 'ServiceNow', 'SharePoint', 'Smart Meter Gateway', 'Substation Monitoring', 'Teams Telephony', 'Vegetation Mgmt', 'Works Planning',
];
const LIFECYCLES = ['active', 'active', 'active', 'retiring', 'planned', 'active', 'retired', 'active'];
const CRITICALITY = ['high', 'medium', 'critical', 'low', 'high', 'medium', null, 'high'];
const DISPOSITION = ['tolerate', 'invest', 'migrate', 'eliminate', null, 'tolerate'];
const OWNERS = ['Asset Management', 'Network Operations', 'Customer', 'Finance', 'IT', null];

const rows: ReportRow[] = NAMES.map((name, i) => ({
  id: `e${String(i)}`,
  name,
  type: i % 9 === 0 ? 'container' : 'system',
  owner: OWNERS[i % OWNERS.length] ?? null,
  lifecycle: LIFECYCLES[i % LIFECYCLES.length] ?? null,
  criticality: CRITICALITY[(i * 3) % CRITICALITY.length] ?? null,
  disposition: DISPOSITION[(i * 5 + Math.floor(i / 6)) % DISPOSITION.length] ?? null,
  search: name.toLowerCase(),
}));
const known = ['name', 'type', 'owner', 'lifecycle', 'criticality', 'disposition', 'id', 'search'];

function spec(over: Partial<ReportSpec>): ReportSpec {
  return { specVersion: REPORT_SPEC_VERSION, source: 'elements', filters: [], columns: ['name', 'owner', 'lifecycle', 'criticality'], sort: [{ field: 'name', direction: 'asc' }], presentation: { kind: 'table' }, ...over };
}
function report(id: string, name: string, s: ReportSpec): SavedReportRow {
  return { id, org_id: 'o', model_id: 'm', name, description: '', spec: s as unknown as SavedReportRow['spec'], spec_version: 1, visibility: 'organisation', created_by: 'u', created_at: '2026-11-07T00:00:00Z', updated_at: '2026-11-07T00:00:00Z' };
}
function tile(id: string, kind: DashboardTileKind, size: DashboardTileSize, position: number, rowLimit: number | null = null): DashboardTileRow {
  return { id, dashboard_id: 'd', report_id: id, position, kind, size, row_limit: rowLimit };
}

const items: { tile: DashboardTileRow; report: SavedReportRow }[] = [
  { tile: tile('r1', 'kpi', 'one', 0), report: report('r1', 'Systems in the estate', spec({ filters: [{ field: 'type', operator: 'eq', value: 'system' }] })) },
  { tile: tile('r2', 'kpi', 'one', 1), report: report('r2', 'Retiring or retired', spec({ filters: [{ field: 'lifecycle', operator: 'in', value: ['retiring', 'retired'] }] })) },
  { tile: tile('r3', 'kpi', 'one', 2), report: report('r3', 'No owner recorded', spec({ filters: [{ field: 'owner', operator: 'isEmpty', value: null }] })) },
  { tile: tile('r4', 'bar', 'two', 3), report: report('r4', 'Systems by lifecycle', spec({ groupBy: 'lifecycle', presentation: { kind: 'barByField' } })) },
  { tile: tile('r5', 'donut', 'one', 4), report: report('r5', 'Criticality mix', spec({ groupBy: 'criticality', presentation: { kind: 'donut' } })) },
  { tile: tile('r6', 'stackedBar', 'two', 5), report: report('r6', 'Disposition by owner', spec({ groupBy: 'owner', splitBy: 'disposition', presentation: { kind: 'barByField' } })) },
  { tile: tile('r7', 'table', 'one', 6, 6), report: report('r7', 'Critical systems', spec({ filters: [{ field: 'criticality', operator: 'eq', value: 'critical' }] })) },
];

function Dashboard() {
  return (
    <MemoryRouter>
      <div style={{ padding: 'var(--space-6)', background: 'var(--bg)', minHeight: '100vh' }}>
        <div className={styles.grid}>
          {items.map(({ tile: t, report: r }) => (
            <section key={t.id} className={styles.tile} style={{ '--span': tileColumnSpan(t.size), order: t.position } as React.CSSProperties}>
              <DashboardTileCard tile={t} report={r} rows={rows} knownFields={known} basePath="/o/x/m/y" />
            </section>
          ))}
        </div>
      </div>
    </MemoryRouter>
  );
}

const meta = {
  title: 'Reports/Dashboard',
  component: Dashboard,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Dashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryTileKind: Story = {};

function ReportPage() {
  const s = spec({ groupBy: 'lifecycle', splitBy: 'criticality' });
  const result = runReport(rows, s, { knownFields: known });
  return (
    <MemoryRouter>
      <div style={{ padding: 'var(--space-6)', background: 'var(--bg)', minHeight: '100vh' }}>
        <ReportResultView result={result} spec={s} onDrill={() => undefined} />
      </div>
    </MemoryRouter>
  );
}

export const GroupedReportPage: StoryObj<typeof ReportPage> = { render: () => <ReportPage /> };

// The standard dashboards over a realistic portfolio (Portfolio source rows).
const COSTS = ['under_50k', '50k_250k', '250k_1m', '1m_5m', 'over_5m', '50k_250k', 'none_included', null];
const FITS = ['good', 'adequate', 'poor', 'excellent', 'adequate', null];
const COST_RANK: Record<string, number> = { none_included: 0, under_50k: 1, '50k_250k': 2, '250k_1m': 3, '1m_5m': 4, over_5m: 5 };
const portfolioRows: ReportRow[] = NAMES.map((name, i) => {
  const cost = COSTS[(i * 3 + 1) % COSTS.length] ?? null;
  const fit = FITS[(i * 5 + 2) % FITS.length] ?? null;
  const costly = cost !== null && (COST_RANK[cost] ?? 0) >= 3;
  const signalKeys = costly && fit === 'poor' ? '|costly_poor_fit|' : '||';
  return {
    id: `p${String(i)}`,
    name,
    kind: i % 9 === 0 ? 'module' : i % 7 === 0 ? 'platform' : 'system',
    elementType: i % 9 === 0 ? 'container' : 'system',
    cost,
    fit,
    criticality: CRITICALITY[(i * 3) % CRITICALITY.length] ?? null,
    disposition: DISPOSITION[(i * 5 + Math.floor(i / 6)) % DISPOSITION.length] ?? null,
    lifecycle: LIFECYCLES[i % LIFECYCLES.length] ?? null,
    capabilities: i % 4,
    owner: OWNERS[i % OWNERS.length] ?? null,
    signals: signalKeys === '||' ? 0 : 1,
    signalKeys,
    costRank: cost === null ? -1 : (COST_RANK[cost] ?? -1),
    ownerSort: OWNERS[i % OWNERS.length] ?? '',
  };
});
const portfolioKnown = Object.keys(portfolioRows[0] ?? {});

function Standard({ index }: { index: number }) {
  const d = STANDARD_DASHBOARDS[index];
  if (d === undefined) return null;
  return (
    <MemoryRouter>
      <div style={{ padding: 'var(--space-6)', background: 'var(--bg)', minHeight: '100vh' }}>
        <h1 style={{ margin: '0 0 var(--space-4)' }}>{d.name}</h1>
        <div className={styles.grid}>
          {d.tiles.map((t, i) => {
            const r = report(`s${String(i)}`, t.name, t.spec);
            const tl = tile(`s${String(i)}`, t.kind, t.size, i, t.rowLimit ?? null);
            return (
              <section key={tl.id} className={styles.tile} style={{ '--span': tileColumnSpan(tl.size), order: tl.position } as React.CSSProperties}>
                <DashboardTileCard tile={tl} report={r} rows={portfolioRows} knownFields={portfolioKnown} basePath="/o/x/m/y" />
              </section>
            );
          })}
        </div>
      </div>
    </MemoryRouter>
  );
}

export const StandardPortfolioOverview: StoryObj<typeof Standard> = { render: () => <Standard index={0} /> };
export const StandardRationalisation: StoryObj<typeof Standard> = { render: () => <Standard index={1} /> };
