/**
 * ADR-029 §2, §5: where the server finds its settings. Pure: the
 * environment, platform and home folder are passed in so it is tested
 * without touching the real ones.
 */
import path from 'node:path';

export interface McpSettings {
  /** The public Supabase project URL (the same one every browser receives). */
  url: string;
  /** The public anon key. Never a service-role key: this server has no use for one. */
  anonKey: string;
  /** Folder holding the saved session. */
  configDir: string;
  /** Sign-in from the environment (Claude Desktop's keychain-held settings); a login file is used when these are absent. */
  email: string | null;
  password: string | null;
}

export interface SettingsInput {
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  homedir: string;
  /** Values baked in when the downloadable bundle is built (`pnpm mcp:bundle`). */
  baked?: { url?: string; anonKey?: string };
}

/** A desktop extension passes an unset setting as the literal "${user_config.…}" placeholder; treat it as empty. */
function clean(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.includes('${') ? null : trimmed;
}

export function defaultConfigDir(platform: NodeJS.Platform, env: SettingsInput['env'], homedir: string): string {
  if (platform === 'win32') return path.win32.join(clean(env.APPDATA) ?? path.win32.join(homedir, 'AppData', 'Roaming'), 'atlas-mcp');
  if (platform === 'darwin') return path.posix.join(homedir, 'Library', 'Application Support', 'atlas-mcp');
  return path.posix.join(clean(env.XDG_CONFIG_HOME) ?? path.posix.join(homedir, '.config'), 'atlas-mcp');
}

export type SettingsResult = { ok: true; settings: McpSettings } | { ok: false; message: string };

export function resolveSettings(input: SettingsInput): SettingsResult {
  const url = clean(input.env.ATLAS_URL) ?? input.baked?.url ?? null;
  const anonKey = clean(input.env.ATLAS_ANON_KEY) ?? input.baked?.anonKey ?? null;
  if (!url || !anonKey) {
    return { ok: false, message: 'This copy of the Atlas server does not know which Atlas to connect to. Download it again from Atlas (Home, "Use Atlas from Claude Desktop"), or set ATLAS_URL and ATLAS_ANON_KEY.' };
  }
  const configDir = clean(input.env.ATLAS_MCP_HOME) ?? defaultConfigDir(input.platform, input.env, input.homedir);
  return { ok: true, settings: { url, anonKey, configDir, email: clean(input.env.ATLAS_EMAIL), password: clean(input.env.ATLAS_PASSWORD) } };
}
