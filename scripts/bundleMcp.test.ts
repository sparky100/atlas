import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATLAS_MODEL_TOOLS } from '../mcp/src/atlasTools';
import { buildManifest } from './bundleMcp';

const template = JSON.parse(readFileSync(new URL('../mcp/bundle/manifest.json', import.meta.url), 'utf8')) as Record<string, unknown>;

describe('the extension manifest', () => {
  const manifest = buildManifest({ template, version: '1.2.3', tools: ATLAS_MODEL_TOOLS });
  const tools = manifest.tools as { name: string; description: string }[];

  it('lists every tool the server offers, once, each with a description', () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['atlas_list_models', 'atlas_get_guide', ...ATLAS_MODEL_TOOLS.map((t) => t.name)]);
    expect(new Set(names).size).toBe(names.length);
    expect(tools.every((t) => t.description.length > 0 && t.description.length <= 200)).toBe(true);
  });

  it('takes its version from the code, and starts the bundled server', () => {
    expect(manifest.version).toBe('1.2.3');
    const server = manifest.server as { entry_point: string; mcp_config: { args: string[] } };
    expect(server.mcp_config.args).toEqual([`\${__dirname}/${server.entry_point}`]);
  });

  it('asks for the sign-in as settings, keeps the password sensitive, and leaves the update check off', () => {
    const config = manifest.user_config as Record<string, { sensitive?: boolean; default?: unknown; required?: boolean }>;
    expect(config.email?.required).toBe(true);
    expect(config.password?.sensitive).toBe(true);
    expect(config.check_for_updates?.default).toBe(false);
  });

  it('passes each setting to an environment variable the server reads', () => {
    const env = (manifest.server as { mcp_config: { env: Record<string, string> } }).mcp_config.env;
    expect(env).toEqual({ ATLAS_EMAIL: '${user_config.email}', ATLAS_PASSWORD: '${user_config.password}', ATLAS_MCP_UPDATE_CHECK: '${user_config.check_for_updates}' });
  });
});
