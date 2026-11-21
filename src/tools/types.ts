/**
 * ADR-028 §1: the shapes shared by every model tool. A tool is a typed,
 * read-only function over one model at one ref (main, in this version) and
 * one commit. It never writes, never throws on bad input (it returns an
 * error the assistant can read and correct), and always says what it read.
 */
import type { UUID } from '../contracts/delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import type { ChangeSummary } from '../db/changeSummary';
import type { OpenDecisionElementLink } from '../db/decisions';
import type { GoalCapabilityRow, GoalRow } from '../contracts/goals';
import type { DecisionPrincipleRow, PrincipleRow } from '../contracts/principles';
import type { BranchRow, DecisionRow, ProjectRow, SavedReportRow } from '../db/types';
import type { CatalogueEntry } from '../db/productCatalogue';

/** Current published catalogue products for one capability, with the catalogue version they came from. */
export interface CapabilityCatalogue {
  sector: string;
  capabilityCode: string;
  capabilityName: string;
  catalogueVersion: number;
  entries: readonly CatalogueEntry[];
}

/** What the lookup needs from a capability when its stored starter-map item may be stale. */
export interface CapabilityCatalogueLookup {
  templateRef: string;
  code: string | null;
}

/** Everything the tools need from the model, read once per question. Plain arrays, so a test can build one by hand. */
export interface ModelSnapshot {
  elements: readonly ElementsHeadRow[];
  relationships: readonly RelationshipsHeadRow[];
  /** Non-merged aliases by element id. */
  aliases: ReadonlyMap<UUID, readonly string[]>;
}

/** What a result was read from. Stated in every result (ADR-028 §1). */
export interface ToolStamp {
  modelId: UUID;
  modelName: string;
  /** `'main'` (live), or the change whose work-in-progress was read (ADR-029: only the local MCP server asks for this). */
  ref: 'main' | { change: UUID };
  commitId: UUID;
}

/** The (lazy, memoised) readers a tool may use. The real ones run as the signed-in user, so row-level security decides what a tool can see. */
/** Whether run cost may reach the AI. Chosen by every caller, never defaulted: an AI path reads the organisation's `ai_share_run_cost`; a path that is not an AI path says `'share'` and why. */
export type RunCostSharing = 'share' | 'exclude';

export interface ToolContext {
  stamp: ToolStamp;
  /** `'exclude'` means run cost has been removed from everything below and tools must not answer from it. Absent reads as `'share'` (hand-built test contexts). */
  runCost?: RunCostSharing;
  snapshot: () => Promise<ModelSnapshot>;
  factsFor: (elementId: UUID) => Promise<readonly FactsRow[]>;
  savedReports: () => Promise<readonly SavedReportRow[]>;
  /** Every fact at the commit (for the stale-attributes finding). */
  allFacts: () => Promise<readonly FactsRow[]>;
  /** Elements an open change is retiring (for the "marked Migrate or Eliminate, nothing retiring it" finding). */
  retiredByOpenChanges: () => Promise<ReadonlySet<UUID>>;
  /** The organisation's stale threshold in months (for the stale-attributes finding). */
  staleAfterMonths: () => Promise<number>;
  /** Open and finished changes of this model (never main or capture drafts). */
  changes: () => Promise<readonly BranchRow[]>;
  decisions: () => Promise<readonly DecisionRow[]>;
  /** The elements each still-open decision concerns. */
  openDecisionLinks: () => Promise<readonly OpenDecisionElementLink[]>;
  projects: () => Promise<readonly ProjectRow[]>;
  /** ADR-035: the model's goals, and which capabilities serve each. */
  goals: () => Promise<readonly GoalRow[]>;
  goalLinks: () => Promise<readonly GoalCapabilityRow[]>;
  /** ADR-034: the model's principles, and which decisions follow or depart from each. */
  principles: () => Promise<readonly PrincipleRow[]>;
  principleLinks: () => Promise<readonly DecisionPrincipleRow[]>;
  /** What one change touches and who it affects, read from its own work against main; `null` when it has made no work yet or does not exist. */
  changeImpact: (change: BranchRow) => Promise<ChangeSummary | null>;
  /** Current published catalogue products for a capability's starter-map item, or its code when that item is stale. Absent where the catalogue is not available to this caller. */
  catalogueForCapability?: (capability: CapabilityCatalogueLookup) => Promise<CapabilityCatalogue | null>;
  /** The clock, passed in so findings that depend on today's date are testable (rule 6). */
  now: () => Date;
}

export type ToolResult = { ok: true; stamp: ToolStamp; data: unknown; total: number | null; truncated: boolean } | { ok: false; error: string };

export interface ModelTool {
  name: string;
  description: string;
  /** JSON Schema for the provider's tool definition, derived from the same validator `run` uses. */
  inputSchema: Record<string, unknown>;
  run: (ctx: ToolContext, input: unknown) => Promise<ToolResult>;
}
