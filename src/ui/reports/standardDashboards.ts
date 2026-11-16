/**
 * ADR-027 (F14 follow-up): the standard dashboards a person can add to a
 * model with one click from the Reports page. Each is a set of ordinary saved
 * report *definitions* (questions, never data: rule 2) plus the tiles that
 * show them. Nothing here runs unless someone chooses "Add standard
 * dashboards", and what it creates is then theirs to edit, rename or delete
 * like any report they saved by hand, so it is not seed data in the rule 7
 * sense: no fact about the architecture is created, and no code path reads
 * these definitions in place of a real query.
 *
 * All reports use the `portfolio` source (systems, platforms and, where
 * asked, modules) and fields that exist on its rows today. Pure.
 */
import { REPORT_SPEC_VERSION, type ReportFilter, type ReportSort, type ReportSpec } from '../../contracts/reportSpec';
import type { DashboardTileKind, DashboardTileSize } from '../../db/types';

export interface StandardTile {
  /** Report name; also the big-number label and the tile title. */
  name: string;
  description: string;
  spec: ReportSpec;
  kind: DashboardTileKind;
  size: DashboardTileSize;
  rowLimit?: number;
}

export interface StandardDashboard {
  key: string;
  name: string;
  summary: string;
  tiles: readonly StandardTile[];
}

/** Applications only: systems and platforms, not the modules inside a platform (the Portfolio page's own default). */
const APPLICATIONS: ReportFilter = { field: 'elementType', operator: 'neq', value: 'container' };
const BY_NAME: ReportSort[] = [{ field: 'name', direction: 'asc' }];
const BY_COST: ReportSort[] = [
  { field: 'costRank', direction: 'desc' },
  { field: 'name', direction: 'asc' },
];

function portfolio(filters: ReportFilter[], over: Partial<ReportSpec> = {}): ReportSpec {
  return {
    specVersion: REPORT_SPEC_VERSION,
    source: 'portfolio',
    filters: [APPLICATIONS, ...filters],
    columns: ['name', 'kind', 'owner', 'lifecycle', 'criticality', 'disposition', 'cost', 'fit'],
    sort: BY_NAME,
    presentation: { kind: 'table' },
    ...over,
  };
}

const OVERVIEW = 'Application portfolio overview';
const TIME = 'Rationalisation (TIME)';
const AI_AGENTS = 'AI agents';
/** Only systems marked as an AI agent. */
const AGENTS_ONLY: ReportFilter = { field: 'aiAutonomy', operator: 'isNotEmpty', value: null };

export const STANDARD_DASHBOARDS: readonly StandardDashboard[] = [
  {
    key: 'portfolio-overview',
    name: OVERVIEW,
    summary: 'How many applications there are, their lifecycle and criticality, and where ownership and planned action are missing.',
    tiles: [
      { name: 'Applications', description: `Every system and platform (not their modules). Part of “${OVERVIEW}”.`, spec: portfolio([], { presentation: { kind: 'count' } }), kind: 'kpi', size: 'one' },
      { name: 'No business owner', description: `Applications with no business owner recorded. Part of “${OVERVIEW}”.`, spec: portfolio([{ field: 'owner', operator: 'isEmpty', value: null }]), kind: 'kpi', size: 'one' },
      { name: 'No planned action', description: `Applications with no planned action (keep, invest, migrate or eliminate) yet. Part of “${OVERVIEW}”.`, spec: portfolio([{ field: 'disposition', operator: 'isEmpty', value: null }]), kind: 'kpi', size: 'one' },
      { name: 'Applications by lifecycle', description: `Part of “${OVERVIEW}”.`, spec: portfolio([], { groupBy: 'lifecycle', presentation: { kind: 'barByField' } }), kind: 'bar', size: 'two' },
      { name: 'Criticality mix', description: `Part of “${OVERVIEW}”.`, spec: portfolio([], { groupBy: 'criticality', presentation: { kind: 'donut' } }), kind: 'donut', size: 'one' },
      { name: 'Planned action by criticality', description: `How the most critical applications are being treated. Part of “${OVERVIEW}”.`, spec: portfolio([], { groupBy: 'criticality', splitBy: 'disposition', presentation: { kind: 'barByField' } }), kind: 'stackedBar', size: 'two' },
      { name: 'Critical applications', description: `Part of “${OVERVIEW}”.`, spec: portfolio([{ field: 'criticality', operator: 'eq', value: 'critical' }], { columns: ['name', 'owner', 'lifecycle', 'disposition'] }), kind: 'table', size: 'one', rowLimit: 10 },
    ],
  },
  {
    key: 'rationalisation',
    name: TIME,
    summary: 'Keep as is, Invest, Move to another system, Switch off: what is planned, where the money goes, and the costly applications that fit poorly.',
    tiles: [
      { name: 'To eliminate or migrate', description: `Applications planned to move or switch off. Part of “${TIME}”.`, spec: portfolio([{ field: 'disposition', operator: 'in', value: ['eliminate', 'migrate'] }], { sort: BY_COST }), kind: 'kpi', size: 'one' },
      { name: 'Costly, poor fit', description: `Applications that cost a lot and fit poorly (the Portfolio signal). Part of “${TIME}”.`, spec: portfolio([{ field: 'signalKeys', operator: 'contains', value: '|costly_poor_fit|' }], { sort: BY_COST, columns: ['name', 'cost', 'fit', 'owner', 'disposition'] }), kind: 'kpi', size: 'one' },
      { name: 'Run cost over £1m', description: `Applications whose avoidable annual run cost is £1m or more. Part of “${TIME}”.`, spec: portfolio([{ field: 'cost', operator: 'in', value: ['1m_5m', 'over_5m'] }], { sort: BY_COST }), kind: 'kpi', size: 'one' },
      { name: 'Planned action', description: `Part of “${TIME}”.`, spec: portfolio([], { groupBy: 'disposition', presentation: { kind: 'donut' } }), kind: 'donut', size: 'one' },
      { name: 'Fit by run cost', description: `Where the money goes, and how well what it buys fits. Part of “${TIME}”.`, spec: portfolio([], { groupBy: 'cost', splitBy: 'fit', presentation: { kind: 'barByField' } }), kind: 'stackedBar', size: 'two' },
      { name: 'Move and switch-off candidates', description: `Most expensive first. Part of “${TIME}”.`, spec: portfolio([{ field: 'disposition', operator: 'in', value: ['eliminate', 'migrate'] }], { sort: BY_COST, columns: ['name', 'disposition', 'cost', 'fit', 'owner'] }), kind: 'table', size: 'two', rowLimit: 10 },
      { name: 'Costly, poor fit: the list', description: `Most expensive first. Part of “${TIME}”.`, spec: portfolio([{ field: 'signalKeys', operator: 'contains', value: '|costly_poor_fit|' }], { sort: BY_COST, columns: ['name', 'cost', 'fit', 'owner'] }), kind: 'table', size: 'one', rowLimit: 10 },
    ],
  },
  {
    key: 'ai-agents',
    name: AI_AGENTS,
    summary: 'Every AI agent in the model: how many there are, how freely they act, who owns them and what they support. An AI agent is a system with “AI agent: how it acts” filled in.',
    tiles: [
      { name: 'AI agents', description: `Every system marked as an AI agent. Part of “${AI_AGENTS}”.`, spec: portfolio([AGENTS_ONLY], { presentation: { kind: 'count' } }), kind: 'kpi', size: 'one' },
      { name: 'AI agents that act alone', description: `Agents that act without anyone checking first. Part of “${AI_AGENTS}”.`, spec: portfolio([{ field: 'aiAutonomy', operator: 'eq', value: 'acts_alone' }], { presentation: { kind: 'count' } }), kind: 'kpi', size: 'one' },
      { name: 'AI agents with no business owner', description: `Agents with no business owner recorded. Part of “${AI_AGENTS}”.`, spec: portfolio([AGENTS_ONLY, { field: 'owner', operator: 'isEmpty', value: null }], { presentation: { kind: 'count' } }), kind: 'kpi', size: 'one' },
      { name: 'How AI agents act', description: `Suggests only, acts with approval, or acts alone. Part of “${AI_AGENTS}”.`, spec: portfolio([AGENTS_ONLY], { groupBy: 'aiAutonomy', presentation: { kind: 'donut' } }), kind: 'donut', size: 'one' },
      {
        name: 'AI agent inventory',
        description: `Every AI agent, the ones that act alone first. Part of “${AI_AGENTS}”.`,
        spec: portfolio([AGENTS_ONLY], { columns: ['name', 'aiAutonomy', 'owner', 'capabilities', 'lifecycle', 'criticality'], sort: [{ field: 'aiAutonomyRank', direction: 'desc' }, { field: 'name', direction: 'asc' }] }),
        kind: 'table',
        size: 'two',
      },
    ],
  },
];
