/**
 * Reading and hashing the API key from a request. Pure apart from the
 * platform's own `crypto.subtle` (the same call in Node and Deno). The hash
 * is what `api_keys.key_hash` stores: lowercase hex SHA-256 of the full key.
 */
import { API_KEY_PATTERN } from '../contracts/api';

/** The key from `Authorization: Bearer atl_…`, or `null` when the header is missing or is not shaped like a key. */
export function parseBearerKey(header: string | null): string | null {
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  return token !== undefined && API_KEY_PATTERN.test(token) ? token : null;
}

export async function hashApiKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
