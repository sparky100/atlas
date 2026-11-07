/**
 * ADR-029 §1: the F15 model tools exposed under `atlas_` names. Each takes
 * the tool's own input plus `model` (id, name or slug; optional when only one
 * model is visible) and an optional `change` (a changeId) to read that
 * change's work-in-progress instead of live main. Everything runs on the
 * signed-in user's own session, so row-level security decides what is seen.
 */
import { z } from 'zod';
import type { UUID } from '../../src/contracts/delta';
import type { Client } from '../../src/db/client';
import { createToolContext } from '../../src/tools/loadContext';
import { MODEL_TOOLS } from '../../src/tools';
import type { ModelTool, ToolContext } from '../../src/tools';
import { listVisibleModels } from './models';
import type { VisibleModel } from './models';

/** One result is clipped to this many characters; the assistant is told to narrow the lookup. */
export const MCP_MAX_RESULT_CHARS = 60_000;
export const DISABLED_MESSAGE = 'Your organisation has not turned on AI access. An owner can switch on Ask Atlas under Organisation settings; it covers AI apps members connect as well.';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MCP_TOOL_PREFIX = 'atlas_';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (supabase: Client, args: unknown) => Promise<{ text: string; isError: boolean }>;
}

const err = (text: string) => ({ text, isError: true });

export type ModelResolution = { ok: true; model: VisibleModel } | { ok: false; message: string };

export function resolveModel(models: readonly VisibleModel[], wanted: string | undefined): ModelResolution {
  const live = models.filter((m) => !m.archived);
  if (wanted === undefined || wanted.trim() === '') {
    if (live.length === 1 && live[0]) return { ok: true, model: live[0] };
    if (live.length === 0) return { ok: false, message: 'There is no model you can read. Call atlas_list_models.' };
    return { ok: false, message: `Several models are visible, so say which with the "model" argument (id, name or slug): ${live.map((m) => `${m.name} (${m.organisation})`).join('; ')}.` };
  }
  const w = wanted.trim().toLowerCase();
  const matches = models.filter((m) => m.modelId.toLowerCase() === w || m.slug.toLowerCase() === w || m.name.toLowerCase() === w);
  if (matches.length === 1 && matches[0]) return { ok: true, model: matches[0] };
  if (matches.length > 1) return { ok: false, message: `More than one model matches "${wanted.slice(0, 60)}": use the model id from atlas_list_models.` };
  return { ok: false, message: `No model called "${wanted.slice(0, 60)}" that you can see. Call atlas_list_models.` };
}

async function isEnabled(supabase: Client, orgId: string): Promise<boolean> {
  const { data, error } = await supabase.from('organisations').select('ai_assistant_enabled').eq('id', orgId).maybeSingle();
  if (error) throw new Error(`Could not read the organisation: ${error.message}`);
  return (data as { ai_assistant_enabled?: boolean } | null)?.ai_assistant_enabled === true;
}


interface BranchHead {
  id: string;
  head_commit_id: string | null;
}

/** Rows come back untyped from the client; this is the one place they are given a shape. */
function asBranchHead(data: unknown): BranchHead | null {
  return (data ?? null) as BranchHead | null;
}

/** The commit to read: main's head, or the head of the named change. */
async function commitFor(supabase: Client, modelId: string, change: string | undefined): Promise<{ ok: true; commitId: UUID; ref: ToolContext['stamp']['ref'] } | { ok: false; message: string }> {
  if (change === undefined) {
    const { data, error } = await supabase.from('branches').select('id, kind, head_commit_id').eq('model_id', modelId).eq('kind', 'main').maybeSingle();
    if (error) throw new Error(`Could not read the live model: ${error.message}`);
    const head = asBranchHead(data)?.head_commit_id ?? null;
    if (head === null) return { ok: false, message: 'This model has nothing in it yet.' };
    return { ok: true, commitId: head, ref: 'main' };
  }
  const { data, error } = await supabase.from('branches').select('id, kind, head_commit_id').eq('model_id', modelId).eq('kind', 'change').eq('id', change).maybeSingle();
  if (error) throw new Error(`Could not read the change: ${error.message}`);
  const row = asBranchHead(data);
  if (!row?.head_commit_id) return { ok: false, message: 'No change with that id in this model that you can see. Use atlas_list_changes.' };
  return { ok: true, commitId: row.head_commit_id, ref: { change: row.id } };
}

const extra = z.object({
  model: z.string().max(200).optional(),
  change: z.string().regex(UUID_SHAPE, 'must be a changeId from atlas_list_changes').optional(),
});

function widen(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  return {
    ...schema,
    type: 'object',
    properties: {
      ...props,
      model: { type: 'string', description: 'Model id, name or slug (from atlas_list_models). Optional when only one model is visible.' },
      change: { type: 'string', description: 'Optional changeId from atlas_list_changes: read that change\'s work-in-progress instead of the live model.' },
    },
  };
}

function wrap(tool: ModelTool): McpToolDef {
  return {
    name: `${MCP_TOOL_PREFIX}${tool.name}`,
    description: `${tool.description} Read-only. Takes optional "model" and "change".`,
    inputSchema: widen(tool.inputSchema),
    run: async (supabase, args) => {
      const raw = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
      const { model: modelArg, change: changeArg, ...rest } = raw;
      const scope = extra.safeParse({ model: modelArg, change: changeArg });
      if (!scope.success) return err(`Invalid input: ${scope.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);

      const resolved = resolveModel(await listVisibleModels(supabase), scope.data.model);
      if (!resolved.ok) return err(resolved.message);
      const { model } = resolved;
      const orgId = await orgIdOf(supabase, model.modelId);
      if (orgId === null) return err('No model with that id that you can see.');
      if (!(await isEnabled(supabase, orgId))) return err(DISABLED_MESSAGE);

      const commit = await commitFor(supabase, model.modelId, scope.data.change);
      if (!commit.ok) return err(commit.message);
      const ctx = createToolContext(supabase, { id: model.modelId, name: model.name }, commit.commitId, commit.ref);
      const result = await tool.run(ctx, rest);
      if (!result.ok) return err(result.error);
      const json = JSON.stringify({ stamp: result.stamp, total: result.total, truncated: result.truncated, data: result.data });
      if (json.length > MCP_MAX_RESULT_CHARS) return err('That result is too large to return. Narrow the lookup (a type, an owner, a smaller limit).');
      return { text: json, isError: false };
    },
  };
}

async function orgIdOf(supabase: Client, modelId: string): Promise<string | null> {
  const { data, error } = await supabase.from('models').select('org_id').eq('id', modelId).maybeSingle();
  if (error) throw new Error(`Could not read the model: ${error.message}`);
  return (data as { org_id?: string } | null)?.org_id ?? null;
}

export const ATLAS_MODEL_TOOLS: readonly McpToolDef[] = MODEL_TOOLS.map(wrap);
