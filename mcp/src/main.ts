#!/usr/bin/env node
/**
 * ADR-029: `atlas-mcp` — the local Atlas MCP server.
 *
 *   atlas-mcp            start the server on stdio (what an AI app runs)
 *   atlas-mcp login      sign in once from a terminal; saves the session
 *   atlas-mcp status     say who is signed in
 *   atlas-mcp logout     forget the saved session
 */
import './stdioGuard';
import os from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAtlasClient } from './client';
import { resolveSettings } from './config';
import { runLogin, runLogout, runStatus } from './loginCli';
import { createAtlasServer } from './serverCore';

declare const __ATLAS_URL__: string | undefined;
declare const __ATLAS_ANON_KEY__: string | undefined;

async function main(): Promise<void> {
  const command = process.argv[2];
  const resolved = resolveSettings({
    env: process.env,
    platform: process.platform,
    homedir: os.homedir(),
    baked: {
      ...(typeof __ATLAS_URL__ === 'string' ? { url: __ATLAS_URL__ } : {}),
      ...(typeof __ATLAS_ANON_KEY__ === 'string' ? { anonKey: __ATLAS_ANON_KEY__ } : {}),
    },
  });
  if (!resolved.ok) {
    console.error(resolved.message);
    process.exitCode = 1;
    return;
  }
  const { settings } = resolved;
  const supabase = createAtlasClient(settings);

  if (command === 'login') {
    process.exitCode = await runLogin(supabase, settings);
    return;
  }
  if (command === 'logout') {
    process.exitCode = await runLogout(supabase);
    return;
  }
  if (command === 'status') {
    process.exitCode = await runStatus(supabase, settings);
    return;
  }
  if (command !== undefined) {
    console.error(`Unknown command "${command}". Use: login, logout, status, or no command to start the server.`);
    process.exitCode = 1;
    return;
  }

  const server = createAtlasServer({ supabase, email: settings.email, password: settings.password });
  await server.connect(new StdioServerTransport());
  console.error('Atlas MCP server ready.');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
