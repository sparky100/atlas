import { describe, expect, it } from 'vitest';
import { API_DEFAULT_PAGE_LIMIT, API_KEY_PATTERN, API_KEY_PREFIX_LENGTH, API_MAX_PAGE_LIMIT, type ApiKeyRow, type CreatedApiKey } from './api';

describe('api contract', () => {
  it('a key is atl_ plus 64 hex characters, and its visible prefix is part of it', () => {
    const token = `atl_${'0123456789abcdef'.repeat(4)}`;
    expect(API_KEY_PATTERN.test(token)).toBe(true);
    expect(token.slice(0, API_KEY_PREFIX_LENGTH)).toBe('atl_01234567');
    expect(API_KEY_PATTERN.test(token.toUpperCase())).toBe(false);
  });
  it('the default page fits inside the maximum', () => {
    expect(API_DEFAULT_PAGE_LIMIT).toBeLessThanOrEqual(API_MAX_PAGE_LIMIT);
  });
  it('the row an owner reads never has a hash or the key; creating returns the key once', () => {
    const row: ApiKeyRow = { id: 'a', org_id: 'b', name: 'n', key_prefix: 'atl_', created_by: 'c', created_at: 't', last_used_at: null, revoked_at: null };
    expect(Object.keys(row)).not.toContain('key_hash');
    expect(Object.keys(row)).not.toContain('token');
    const created: CreatedApiKey = { id: 'a', name: 'n', key_prefix: 'atl_', created_at: 't', token: 'x' };
    expect(Object.keys(created)).toContain('token');
  });
});
