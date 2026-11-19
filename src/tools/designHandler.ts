/**
 * Phase D step 2: everything the `design-agent` edge function decides, with
 * its collaborators injected so it is tested without a Deno runtime (the same
 * split `ask-model` uses). Order matters and is the point of this file: the
 * model must be readable by the caller, the organisation must have Ask Atlas
 * on, the agents switch on and an AI key saved, and only then is anything sent
 * to a provider. It then runs the Designer on the organisation's own key
 * (never the platform key) with run cost withheld unless the owner shares it.
 *
 * The Designer writes nothing. Its draft is text for a person to read and edit.
 */
import type { UUID } from '../contracts/delta';
import { runAsk } from './askLoop';
import type { AskModelClient, AskResult } from './askLoop';
import { designerBrief, designerSystemPrompt, DESIGNER_MAX_FINDING_CHARS } from './designPrompt';
import type { RunCostSharing, ToolContext, ToolStamp } from './types';

export interface DesignModelInfo {
  id: UUID;
  orgId: UUID;
  name: string;
}

export interface DesignHandlerDeps {
  /** Read with the caller's own session: a model the caller cannot read is `null`. */
  loadModel: (modelId: UUID) => Promise<DesignModelInfo | null>;
  /** The organisation's own switches and key flag. */
  agentSettings: (orgId: UUID) => Promise<{ assistantEnabled: boolean; agentsEnabled: boolean; keySet: boolean }>;
  /** The caller's role in the organisation, or `null`. */
  callerRole: (orgId: UUID) => Promise<string | null>;
  /** The owning organisation's `ai_share_run_cost` (default off). */
  shareRunCost: (orgId: UUID) => Promise<boolean>;
  mainCommit: (modelId: UUID) => Promise<UUID | null>;
  createContext: (model: DesignModelInfo, commitId: UUID, runCost: RunCostSharing) => ToolContext;
  /** A client that uses the organisation's own key (`useOrgKey`), never the platform key. */
  createClient: (orgId: UUID) => AskModelClient;
}

export type DesignOutcome =
  | { status: 'invalid'; message: string }
  | { status: 'not_found' }
  | { status: 'forbidden'; message: string }
  | { status: 'not_enabled'; message: string }
  | { status: 'empty_model' }
  | { status: 'done'; result: AskResult; stamp: ToolStamp };

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedDesign {
  modelId: UUID;
  elementId: UUID;
  finding: string;
}

export function parseDesignBody(body: unknown): ParsedDesign | string {
  if (typeof body !== 'object' || body === null) return 'A request body is required.';
  const r = body as Record<string, unknown>;
  if (typeof r.modelId !== 'string' || !UUID_SHAPE.test(r.modelId)) return 'modelId must be a model id.';
  if (typeof r.elementId !== 'string' || !UUID_SHAPE.test(r.elementId)) return 'elementId must be an element id.';
  if (typeof r.finding !== 'string' || r.finding.trim() === '') return 'finding is required.';
  if (r.finding.trim().length > DESIGNER_MAX_FINDING_CHARS) return `finding must be at most ${String(DESIGNER_MAX_FINDING_CHARS)} characters.`;
  return { modelId: r.modelId, elementId: r.elementId, finding: r.finding.trim() };
}

export async function handleDesign(deps: DesignHandlerDeps, body: unknown): Promise<DesignOutcome> {
  const parsed = parseDesignBody(body);
  if (typeof parsed === 'string') return { status: 'invalid', message: parsed };

  const model = await deps.loadModel(parsed.modelId);
  if (!model) return { status: 'not_found' };

  const role = await deps.callerRole(model.orgId);
  if (role !== 'owner' && role !== 'architect') return { status: 'forbidden', message: 'Only an owner or architect can run the Designer.' };

  const settings = await deps.agentSettings(model.orgId);
  if (!settings.assistantEnabled || !settings.agentsEnabled || !settings.keySet) {
    return { status: 'not_enabled', message: 'Agents are not switched on for this organisation, or it has no AI key saved. An owner can set this in organisation settings.' };
  }

  const commitId = await deps.mainCommit(model.id);
  if (commitId === null) return { status: 'empty_model' };

  const runCost: RunCostSharing = (await deps.shareRunCost(model.orgId)) ? 'share' : 'exclude';
  const ctx = deps.createContext(model, commitId, runCost);
  const result = await runAsk({
    client: deps.createClient(model.orgId),
    ctx,
    history: [],
    question: designerBrief({ elementId: parsed.elementId, finding: parsed.finding }),
    system: designerSystemPrompt(ctx.stamp.modelName, ctx.now().toISOString().slice(0, 10), { runCost }),
  });
  return { status: 'done', result, stamp: ctx.stamp };
}
