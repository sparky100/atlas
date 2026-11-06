/**
 * ADR-028 §1: the shapes shared by every model tool. A tool is a typed,
 * read-only function over one model at one ref (main, in this version) and
 * one commit. It never writes, never throws on bad input (it returns an
 * error the assistant can read and correct), and always says what it read.
 */
import type { UUID } from '../contracts/delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import type { SavedReportRow } from '../db/types';

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
  ref: 'main';
  commitId: UUID;
}

/** The (lazy, memoised) readers a tool may use. The real ones run as the signed-in user, so row-level security decides what a tool can see. */
export interface ToolContext {
  stamp: ToolStamp;
  snapshot: () => Promise<ModelSnapshot>;
  factsFor: (elementId: UUID) => Promise<readonly FactsRow[]>;
  savedReports: () => Promise<readonly SavedReportRow[]>;
  /** Every fact at the commit (for the stale-attributes finding). */
  allFacts: () => Promise<readonly FactsRow[]>;
  /** Elements an open change is retiring (for the "marked Migrate or Eliminate, nothing retiring it" finding). */
  retiredByOpenChanges: () => Promise<ReadonlySet<UUID>>;
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
