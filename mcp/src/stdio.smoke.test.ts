/**
 * ADR-029 step 4: the real process over real stdio. Starts `main.ts` as an
 * AI app would, talks the protocol to it, and checks nothing but protocol
 * reaches stdout. No network: tools that need no sign-in answer, and one that
 * does says how to sign in.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, describe, expect, it } from 'vitest';
import { NOT_SIGNED_IN } from './auth';

const home = mkdtempSync(path.join(os.tmpdir(), 'atlas-mcp-smoke-'));
afterAll(() => { rmSync(home, { recursive: true, force: true }); });

describe('atlas-mcp over stdio', () => {
  it('starts, lists its tools, serves the guide and explains sign-in', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', path.resolve('mcp/src/main.ts')],
      env: { PATH: process.env.PATH ?? '', ATLAS_URL: 'http://127.0.0.1:1', ATLAS_ANON_KEY: 'not-a-real-key', ATLAS_MCP_HOME: home },
      stderr: 'pipe',
    });
    const client = new McpClient({ name: 'smoke', version: '0' });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['atlas_list_models', 'atlas_get_guide', 'atlas_search_elements']));

      const guide = await client.callTool({ name: 'atlas_get_guide', arguments: {} });
      expect(guide.isError).toBeFalsy();

      const models = await client.callTool({ name: 'atlas_list_models', arguments: {} });
      expect(models.isError).toBe(true);
      expect((models.content as { text: string }[])[0]?.text).toBe(NOT_SIGNED_IN);
    } finally {
      await client.close();
    }
  }, 30_000);
});
