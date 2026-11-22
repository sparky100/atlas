/**
 * Phase D step 2: everything the `design-agent` edge function decides, with
 * its collaborators injected so it is tested without a Deno runtime (the same
 * split `ask-model` uses). Order matters and is the point of this file: the
 * model must be readable by the caller, the organisation must have Ask Atlas
 * on and the agents switch on, and either an AI key saved or free-trial runs left,
 * and only then is anything sent to a provider. It then runs the Designer on the
 * organisation's own key (or the free trial, never the platform key otherwise) with run cost withheld unless the owner shares it.
 *
 * The Designer writes nothing. Its draft is text for a person to read and edit.
 */
import type { UUID } from '../contracts/delta';
import { parseDesignerOptions, type DesignerOptionsResult } from '../contracts/designerOptions';
import { runAsk } from './askLoop';
import type { AskModelClient, AskResult } from './askLoop';
import { designerBrief, designerSystemPrompt, DESIGNER_MAX_FINDING_CHARS } from './designPrompt';
import { catalogueRefKey, capabilityCode, capabilityTemplateRef } from './findCatalogueProducts';
import { indexSnapshot } from './toolKit';
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
  /** Runs the organisation has left on the platform key's free trial (0 once used up). Only asked when it has no key of its own. */
  trialRunsLeft: (orgId: UUID) => Promise<number>;
  /** A fresh id for this run, so the trial counts a run once however many model calls it makes. */
  newRunId: () => string;
  /** A client that uses the organisation's own key when it has one, otherwise the free trial (`useOrgKey` + `runId`), never the platform key outside the trial. */
  createClient: (orgId: UUID, runId: string) => AskModelClient;
}

export type DesignOutcome =
  | { status: 'invalid'; message: string }
  | { status: 'not_found' }
  | { status: 'forbidden'; message: string }
  | { status: 'not_enabled'; message: string }
  | { status: 'empty_model' }
  | { status: 'done'; result: AskResult; stamp: ToolStamp; design: DesignerOptionsResult };

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A structured answer with 3-5 options, sources and reasoning needs more room than a short Ask Atlas reply. */
const DESIGNER_MAX_TOKENS_PER_ROUND = 4000;

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

/** Citation keys the run actually read from the catalogue. A cited product not in this set was never returned by a tool, so it is dropped. */
async function returnedCatalogueKeys(ctx: ToolContext, toolUses: readonly { name: string; input: Record<string, unknown>; ok: boolean }[]): Promise<Set<string>> {
  const ids = [...new Set(toolUses.filter((u) => u.name === 'find_catalogue_products' && u.ok).map((u) => u.input.capability_element_id).filter((v): v is string => typeof v === 'string'))];
  const allowed = new Set<string>();
  if (ids.length === 0 || ctx.catalogueForCapability === undefined) return allowed;
  const index = indexSnapshot(await ctx.snapshot());
  for (const id of ids) {
    const element = index.byId.get(id);
    const templateRef = capabilityTemplateRef(element?.attributes);
    if (templateRef === null) continue;
    const catalogue = await ctx.catalogueForCapability({ templateRef, code: capabilityCode(element?.attributes) });
    if (catalogue === null) continue;
    for (const entry of catalogue.entries) allowed.add(catalogueRefKey({ sector: catalogue.sector, version: catalogue.catalogueVersion, entryCode: entry.code }));
  }
  return allowed;
}

export async function handleDesign(deps: DesignHandlerDeps, body: unknown): Promise<DesignOutcome> {
  const parsed = parseDesignBody(body);
  if (typeof parsed === 'string') return { status: 'invalid', message: parsed };

  const model = await deps.loadModel(parsed.modelId);
  if (!model) return { status: 'not_found' };

  const role = await deps.callerRole(model.orgId);
  // Contributors may run it: they can start decisions, the Designer only drafts text and writes nothing, and the owner still controls it through the organisation's switches and key (journey proposal section 6).
  if (role !== 'owner' && role !== 'architect' && role !== 'contributor') return { status: 'forbidden', message: 'Only an owner, architect or contributor can run the Designer.' };

  const settings = await deps.agentSettings(model.orgId);
  if (!settings.assistantEnabled || !settings.agentsEnabled) {
    return { status: 'not_enabled', message: 'Agents are not switched on for this organisation. An owner can switch them on in organisation settings.' };
  }
  // No key of its own: the free trial, until it is used up. The proxy checks the same thing and is the real gate.
  if (!settings.keySet && (await deps.trialRunsLeft(model.orgId)) <= 0) {
    return { status: 'not_enabled', message: "The free trial of the Designer is used up. An owner needs to add the organisation's AI key in organisation settings." };
  }

  const commitId = await deps.mainCommit(model.id);
  if (commitId === null) return { status: 'empty_model' };

  const runCost: RunCostSharing = (await deps.shareRunCost(model.orgId)) ? 'share' : 'exclude';
  const ctx = deps.createContext(model, commitId, runCost);
  const result = await runAsk({
    client: deps.createClient(model.orgId, deps.newRunId()),
    ctx,
    history: [],
    question: designerBrief({ elementId: parsed.elementId, finding: parsed.finding, webSearch: settings.keySet }),
    system: designerSystemPrompt(ctx.stamp.modelName, ctx.now().toISOString().slice(0, 10), { runCost }),
    maxTokensPerRound: DESIGNER_MAX_TOKENS_PER_ROUND,
  });
  const design = parseDesignerOptions(result.answer);
  const returnedWebUrls = new Set([...(result.webSearch.results), ...(result.webSearch.citations)].map((source) => source.url));
  let droppedWebRefs = 0;
  for (const option of design.options) {
    const kept = option.webRefs.filter((ref) => returnedWebUrls.has(ref.url));
    droppedWebRefs += option.webRefs.length - kept.length;
    option.webRefs = kept;
  }
  if (droppedWebRefs > 0) {
    design.problems.push(droppedWebRefs === 1
      ? 'One web page was left out because the search did not return it. Add it by hand only if you have checked it yourself.'
      : `${String(droppedWebRefs)} web pages were left out because the search did not return them. Add one by hand only if you have checked it yourself.`);
  }
  const allowedCatalogueRefs = await returnedCatalogueKeys(ctx, result.toolUses);
  let droppedCatalogueRefs = 0;
  for (const option of design.options) {
    const kept = option.catalogueRefs.filter((ref) => allowedCatalogueRefs.has(catalogueRefKey(ref)));
    droppedCatalogueRefs += option.catalogueRefs.length - kept.length;
    option.catalogueRefs = kept;
  }
  if (droppedCatalogueRefs > 0) {
    design.problems.push(droppedCatalogueRefs === 1
      ? 'One catalogue product was left out because the Designer did not read it. Add it by hand only if you have checked it yourself.'
      : `${String(droppedCatalogueRefs)} catalogue products were left out because the Designer did not read them. Add one by hand only if you have checked it yourself.`);
  }
  // A run cut off by a limit is never complete, whatever the part that arrived looks like.
  // Say why even when parsing already failed, so "did not return options" is not the only clue.
  if (result.status !== 'answered') {
    const reason = result.limit === 'rounds'
      ? 'The Designer used all its lookup rounds before it finished.'
      : result.limit === 'budget'
        ? 'The Designer used its lookup budget before it finished.'
        : 'The Designer was cut short, so this answer may be incomplete.';
    if (!design.problems.includes(reason)) design.problems.push(reason);
  }
  return { status: 'done', result, stamp: ctx.stamp, design };
}
