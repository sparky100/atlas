import { describe, expect, it } from 'vitest';
import { defaultConfigDir, resolveSettings } from './config';

const base = { platform: 'linux' as const, homedir: '/home/ada', env: { ATLAS_URL: 'https://x.supabase.co', ATLAS_ANON_KEY: 'anon' } };

describe('resolveSettings', () => {
  it('reads the project from the environment and defaults the session folder per platform', () => {
    const r = resolveSettings(base);
    expect(r.ok && r.settings).toMatchObject({ url: 'https://x.supabase.co', anonKey: 'anon', configDir: '/home/ada/.config/atlas-mcp', email: null, password: null });
    expect(defaultConfigDir('darwin', {}, '/Users/ada')).toBe('/Users/ada/Library/Application Support/atlas-mcp');
    expect(defaultConfigDir('win32', { APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' }, 'C:\\Users\\ada')).toBe('C:\\Users\\ada\\AppData\\Roaming\\atlas-mcp');
    expect(defaultConfigDir('linux', { XDG_CONFIG_HOME: '/x' }, '/home/ada')).toBe('/x/atlas-mcp');
  });

  it('falls back to the values baked into the downloadable bundle', () => {
    const r = resolveSettings({ ...base, env: {}, baked: { url: 'https://baked.test', anonKey: 'k' } });
    expect(r.ok && r.settings.url).toBe('https://baked.test');
  });

  it('treats an unset desktop-extension placeholder as empty, and picks up real sign-in values', () => {
    const r = resolveSettings({ ...base, env: { ...base.env, ATLAS_EMAIL: '${user_config.email}', ATLAS_PASSWORD: ' pw ' } });
    expect(r.ok && r.settings.email).toBeNull();
    expect(r.ok && r.settings.password).toBe('pw');
  });

  it('says plainly when it does not know which Atlas to connect to', () => {
    const r = resolveSettings({ ...base, env: {} });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/does not know which Atlas/);
  });
});
