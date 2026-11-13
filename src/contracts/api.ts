/**
 * Wire and storage contract for the read-only API (docs/ADR-031-read-only-api.md).
 * Types and constants only: no logic, no I/O (the rule for this folder).
 *
 * Two halves:
 *   - the `api_keys` table row an organisation owner sees (never the key
 *     itself, never its hash), and the one-time result of creating a key;
 *   - the JSON the `api` edge function returns under `/v1`.
 *
 * Adding a field to a v1 response is allowed; renaming, removing or
 * re-typing one is a new version (`/v2`).
 */
import type { UUID } from './delta';
import type { Json } from './rows';

export const API_VERSION = 'v1';

/** A key is `atl_` plus 64 hex characters (two random UUIDs, hyphens removed). The first 12 characters are kept visible as `key_prefix`. */
export const API_KEY_PATTERN = /^atl_[0-9a-f]{64}$/;
export const API_KEY_PREFIX_LENGTH = 12;
export const API_KEY_NAME_MAX = 80;
export const API_KEYS_PER_ORG_MAX = 20;

/** Requests per key per minute (fixed one-minute window). Over it: 429 with `Retry-After`. */
export const API_RATE_LIMIT_PER_MINUTE = 120;

export const API_DEFAULT_PAGE_LIMIT = 50;
export const API_MAX_PAGE_LIMIT = 200;

/** The literal shape of a row an owner can read from `api_keys` (the column grant leaves `key_hash` out). */
export interface ApiKeyRow {
  id: UUID;
  org_id: UUID;
  name: string;
  key_prefix: string;
  created_by: UUID;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** What `atlas.create_api_key` returns: the new key's row fields plus the full key, which is never readable again. */
export interface CreatedApiKey {
  id: UUID;
  name: string;
  key_prefix: string;
  created_at: string;
  token: string;
}

// ---------------------------------------------------------------------------
// /v1 responses
// ---------------------------------------------------------------------------

export interface ApiPage {
  limit: number;
  /** Pass back as `cursor` for the next page; `null` on the last page. Opaque: do not parse it. */
  next_cursor: string | null;
  /** The number of rows matching the request, across every page. */
  total: number;
}

export interface ApiMeta {
  api_version: typeof API_VERSION;
  /** What the answer was read from: live main, at this commit. Absent on `/v1/models`. */
  model?: { id: UUID; name: string };
  commit_id?: UUID;
}

export interface ApiList<T> {
  data: T[];
  page: ApiPage;
  meta: ApiMeta;
}

export interface ApiItem<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiError {
  error: { code: 'unauthorized' | 'rate_limited' | 'not_found' | 'bad_request' | 'method_not_allowed' | 'empty_model' | 'server_error'; message: string };
}

export interface ApiModel {
  id: UUID;
  name: string;
  slug: string;
  description: string | null;
}

export interface ApiElement {
  id: UUID;
  type: string;
  name: string;
  parent_id: UUID | null;
  attributes: Json;
}

export interface ApiFact {
  attribute: string;
  value: Json | null;
  source_id: UUID;
  source_ref: string | null;
  confidence: number;
  effective_date: string | null;
  asserted_at: string;
}

export interface ApiElementDetail extends ApiElement {
  aliases: string[];
  /** Every attribute value with where it came from (provenance). */
  facts: ApiFact[];
}

export interface ApiCapability {
  id: UUID;
  name: string;
  parent_id: UUID | null;
  attributes: Json;
  /** Ids of the systems that support this capability. */
  supported_by: UUID[];
}

export interface ApiRelationship {
  id: UUID;
  type: string;
  from_element_id: UUID;
  to_element_id: UUID;
  attributes: Json;
}

export interface ApiFindingSummary {
  key: string;
  label: string;
  count: number;
}

export interface ApiFindingElement {
  id: UUID;
  type: string;
  name: string;
}
