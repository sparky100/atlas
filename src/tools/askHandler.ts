/**
 * ADR-028 §2, §7: everything the `ask-model` edge function decides, with its
 * collaborators injected so it is tested without a Deno runtime (the same
 * "thin transport shim" split `capture-run` uses). Order matters and is the
 * point of this file: the model must be readable by the caller, the owning
 * organisation must have switched Ask Atlas on, and only then is anything
 * sent to the provider.
 */
import type { UUID } from '../contracts/delta';
import { runAsk } from './askLoop';
import type { AskEvent, AskModelClient, AskResult, AskTurn } from './askLoop';
import type { RunCostSharing, ToolContext, ToolStamp } from './types';

export interface AskModelInfo {
  id: UUID;
  orgId: UUID;
  name: string;
}

export interface AskHandlerDeps {
  /** Read with the caller's own session: a model the caller cannot read is `null`. */
  loadModel: (modelId: UUID) => Promise<AskModelInfo | null>;
  /** The owning organisation's `ai_assistant_enabled`. */
  isEnabled: (orgId: UUID) => Promise<boolean>;
  /** Head commit of the model's main line, or `null` when it has none. */
  mainCommit: (modelId: UUID) => Promise<UUID | null>;
  /** The owning organisation's `ai_share_run_cost` (default off): whether run cost may reach the model. */
  shareRunCost: (orgId: UUID) => Promise<boolean>;
  createContext: (model: AskModelInfo, commitId: UUID, runCost: RunCostSharing) => ToolContext;
  createClient: (orgId: UUID) => AskModelClient;
}

export type AskOutcome =
  | { status: 'invalid'; message: string }
  | { status: 'not_found' }
  | { status: 'disabled' }
  | { status: 'empty_model' }
  | { status: 'done'; result: AskResult; stamp: ToolStamp };

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedAsk {
  modelId: UUID;
  question: string;
  history: AskTurn[];
}

export function parseAskBody(body: unknown): ParsedAsk | string {
  if (typeof body !== 'object' || body === null) return 'A request body is required.';
  const r = body as Record<string, unknown>;
  if (typeof r.modelId !== 'string' || !UUID_SHAPE.test(r.modelId)) return 'modelId must be a model id.';
  if (typeof r.question !== 'string' || r.question.trim() === '') return 'question is required.';
  const history: AskTurn[] = [];
  if (r.history !== undefined) {
    if (!Array.isArray(r.history)) return 'history must be a list of turns.';
    for (const turn of r.history as unknown[]) {
      if (typeof turn !== 'object' || turn === null) return 'Each history turn must be an object.';
      const t = turn as Record<string, unknown>;
      if ((t.role !== 'user' && t.role !== 'assistant') || typeof t.text !== 'string') return 'Each history turn needs a role of user or assistant and some text.';
      history.push({ role: t.role, text: t.text });
    }
  }
  return { modelId: r.modelId, question: r.question, history };
}

export async function handleAsk(deps: AskHandlerDeps, body: unknown, onEvent?: (event: AskEvent) => void): Promise<AskOutcome> {
  const parsed = parseAskBody(body);
  if (typeof parsed === 'string') return { status: 'invalid', message: parsed };

  const model = await deps.loadModel(parsed.modelId);
  if (!model) return { status: 'not_found' };
  if (!(await deps.isEnabled(model.orgId))) return { status: 'disabled' };
  const commitId = await deps.mainCommit(model.id);
  if (!commitId) return { status: 'empty_model' };

  const runCost: RunCostSharing = (await deps.shareRunCost(model.orgId)) ? 'share' : 'exclude';
  const ctx = deps.createContext(model, commitId, runCost);
  const result = await runAsk({ client: deps.createClient(model.orgId), ctx, history: parsed.history, question: parsed.question, onEvent });
  return { status: 'done', result, stamp: ctx.stamp };
}
