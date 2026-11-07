/**
 * ADR-029: the MCP server itself, with everything it needs passed in so it
 * can be driven in a test over an in-memory transport. `main.ts` is the only
 * place that touches the real process, files and network.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Client } from '../../src/db/client';
import { ensureSignedIn } from './auth';
import { ATLAS_MODEL_TOOLS } from './atlasTools';
import { ATLAS_GUIDE } from './guide';
import { listVisibleModels } from './models';

export const SERVER_NAME = 'atlas';
import { SERVER_VERSION } from './version';

export { SERVER_VERSION };

export interface ServerDeps {
  supabase: Client;
  email: string | null;
  password: string | null;
  /** From the optional update check; shown to the assistant so it can tell the person. */
  updateNotice?: string | null;
}

type ToolReply = CallToolResult;

const text = (t: string): ToolReply => ({ content: [{ type: 'text', text: t }] });
const problem = (t: string): ToolReply => ({ content: [{ type: 'text', text: t }], isError: true });

/** Signs in (or refreshes) before every tool runs and turns any failure into a plain message for the assistant, never a crash. */
export function guarded(deps: ServerDeps, run: () => Promise<ToolReply>): Promise<ToolReply> {
  return (async () => {
    try {
      const signedIn = await ensureSignedIn(deps.supabase.auth, { email: deps.email, password: deps.password });
      if (!signedIn.ok) return problem(signedIn.message);
      return await run();
    } catch (e) {
      return problem(`Atlas could not answer that: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();
}

const INSTRUCTIONS = [
  'Tools for Atlas, an enterprise-architecture model of an organisation (capabilities, systems, actors and how they relate).',
  'Everything here is read-only and shows only what the signed-in person can already see in Atlas.',
  'Call atlas_list_models first to see which models there are, and atlas_get_guide for which tool answers which question.',
].join('\n');

const NO_INPUT = { type: 'object', properties: {} } as const;

/* eslint-disable @typescript-eslint/no-deprecated -- the SDK marks `Server` deprecated for the high-level API, but this is the advanced case it allows: the tools carry their own JSON Schema, which `McpServer.registerTool` (Zod only) cannot take. */
/**
 * Built on the SDK's low-level `Server` (not `McpServer`) because the F15 tools
 * already carry their own JSON Schema, and `McpServer.registerTool` wants Zod.
 */
export function createAtlasServer(deps: ServerDeps): Server {
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} }, instructions: deps.updateNotice ? `${INSTRUCTIONS}\n${deps.updateNotice}` : INSTRUCTIONS });

  const listModels = {
    name: 'atlas_list_models',
    description: 'List the Atlas models you can see: model id, name, organisation, and whether it is archived. Read-only.',
    inputSchema: NO_INPUT,
  };
  const guide = {
    name: 'atlas_get_guide',
    description: 'How Atlas is organised and which atlas_ tool answers which kind of question. No model data. Read-only.',
    inputSchema: NO_INPUT,
  };

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [listModels, guide, ...ATLAS_MODEL_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as { type: 'object' } }))],
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name } = request.params;
    const args: unknown = request.params.arguments ?? {};
    if (name === 'atlas_get_guide') return Promise.resolve(text(ATLAS_GUIDE));
    if (name === 'atlas_list_models') {
      return guarded(deps, async () => {
        const models = await listVisibleModels(deps.supabase);
        if (models.length === 0) return text('You can sign in, but you do not belong to any organisation with a model yet.');
        return text(JSON.stringify({ models }, null, 2));
      });
    }
    const tool = ATLAS_MODEL_TOOLS.find((t) => t.name === name);
    if (!tool) return Promise.resolve(problem(`There is no tool called "${name.slice(0, 60)}". Call atlas_get_guide.`));
    return guarded(deps, async () => {
      const out = await tool.run(deps.supabase, args);
      return out.isError ? problem(out.text) : text(out.text);
    });
  });

  return server;
}
