import { describe, expect, it } from 'vitest';
import { assertLocalSupabaseUrl, assertLocalTestEnvironment } from './assertLocalSupabase';

describe('assertLocalSupabaseUrl', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321', 'http://host.docker.internal:54321'])(
    'allows %s',
    (url) => {
      expect(() => { assertLocalSupabaseUrl('SUPABASE_URL', url); }).not.toThrow();
    },
  );

  it.each([
    'https://abcdefghijklmnop.supabase.co',
    'https://localhost.evil.example',
    'http://127.0.0.1.evil.example:54321',
    'https://evil.example/localhost',
  ])('refuses %s', (url) => {
    expect(() => { assertLocalSupabaseUrl('SUPABASE_URL', url); }).toThrowError(/Refusing to run tests/);
  });

  it('refuses a malformed URL', () => {
    expect(() => { assertLocalSupabaseUrl('SUPABASE_URL', 'nonsense'); }).toThrowError(/not a valid URL/);
  });

  it('ignores an unset variable', () => {
    expect(() => { assertLocalSupabaseUrl('SUPABASE_URL', undefined); }).not.toThrow();
  });
});

describe('assertLocalTestEnvironment', () => {
  it('refuses when either URL is live', () => {
    expect(() => { assertLocalTestEnvironment({ SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_URL: 'https://x.supabase.co' }); }).toThrowError(
      /VITE_SUPABASE_URL/,
    );
    expect(() => { assertLocalTestEnvironment({ SUPABASE_URL: 'https://x.supabase.co' }); }).toThrowError(/SUPABASE_URL/);
  });
});
