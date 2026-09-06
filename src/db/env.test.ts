import { beforeEach, describe, expect, it } from 'vitest';
import { _resetEnvCacheForTests, loadEnv } from './env';

describe('loadEnv', () => {
  beforeEach(() => {
    _resetEnvCacheForTests();
  });

  it('parses a valid environment', () => {
    const env = loadEnv({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'anon-key',
    });
    expect(env.SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(env.SUPABASE_ANON_KEY).toBe('anon-key');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it('accepts an optional service role key', () => {
    const env = loadEnv({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('service-key');
  });

  it('throws naming every missing variable, not just the first', () => {
    expect(() => loadEnv({})).toThrowError(/SUPABASE_URL.*SUPABASE_ANON_KEY|SUPABASE_ANON_KEY.*SUPABASE_URL/s);
  });

  it('rejects a malformed URL', () => {
    expect(() =>
      loadEnv({ SUPABASE_URL: 'not-a-url', SUPABASE_ANON_KEY: 'anon-key' }),
    ).toThrowError(/SUPABASE_URL/);
  });

  it('caches the first successful parse and ignores later env changes until reset', () => {
    const first = loadEnv({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'a' });
    const second = loadEnv({ SUPABASE_URL: 'http://127.0.0.1:9999', SUPABASE_ANON_KEY: 'b' });
    expect(second).toBe(first);
  });
});
