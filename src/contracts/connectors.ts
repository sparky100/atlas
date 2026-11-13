/**
 * Wire and storage contract for live connectors (docs/ADR-032-connectors.md).
 * Types, constants and one pure validator: no I/O.
 *
 * A connector is an organisation's saved connection to another tool. It only
 * *fetches* a file in the format that tool's import source already reads, so
 * the result goes through the ordinary capture pipeline. Adding a connector
 * is a new `kind` here (and in the `org_connectors.kind` check), a fetcher in
 * `src/connectors/`, and a settings form — nothing else.
 */
import type { UUID } from './delta';

export const CONNECTOR_KINDS = ['mulesoft'] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

export const MULESOFT_REGIONS = ['us', 'eu', 'gov'] as const;
export type MulesoftRegion = (typeof MULESOFT_REGIONS)[number];

/** The non-secret MuleSoft settings stored in `org_connectors.config`. The client secret is never part of this: it lives in Supabase Vault. */
export interface MulesoftConnectorConfig {
  region: MulesoftRegion;
  /** The Anypoint organisation (or business group) id. */
  organizationId: string;
  /** The connected app's client id. */
  clientId: string;
  /** Environment names to read, for example `Production`. */
  environments: string[];
}

export const MULESOFT_MAX_ENVIRONMENTS = 10;

export type ConnectorFetchStatus = 'ok' | 'error';

/** The literal shape of a row an owner or architect can read from `org_connectors` (the column grant leaves `secret_id` out). */
export interface ConnectorRow {
  id: UUID;
  org_id: UUID;
  kind: ConnectorKind;
  config: Record<string, unknown>;
  created_by: UUID;
  created_at: string;
  updated_at: string;
  last_fetch_at: string | null;
  last_fetch_status: ConnectorFetchStatus | null;
  last_fetch_message: string | null;
}

export type MulesoftConfigResult = { ok: true; config: MulesoftConnectorConfig } | { ok: false; error: string };

/** Checks what a person typed (or what is stored) is a usable MuleSoft setting. Plain-English errors, because they are shown as they are. */
export function parseMulesoftConfig(raw: unknown): MulesoftConfigResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'The MuleSoft settings are missing.' };
  const r = raw as Record<string, unknown>;
  const region = r.region;
  if (typeof region !== 'string' || !(MULESOFT_REGIONS as readonly string[]).includes(region)) return { ok: false, error: 'Choose the Anypoint region your organisation uses.' };
  const organizationId = typeof r.organizationId === 'string' ? r.organizationId.trim() : '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(organizationId)) return { ok: false, error: 'The organisation ID should be the long ID from Anypoint (letters, numbers and dashes).' };
  const clientId = typeof r.clientId === 'string' ? r.clientId.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientId)) return { ok: false, error: 'The client ID should be the one shown for your connected app in Anypoint.' };
  if (!Array.isArray(r.environments)) return { ok: false, error: 'List at least one environment, for example Production.' };
  const environments = [...new Set((r.environments as unknown[]).filter((e): e is string => typeof e === 'string').map((e) => e.trim()).filter((e) => e !== ''))];
  if (environments.length === 0) return { ok: false, error: 'List at least one environment, for example Production.' };
  if (environments.length > MULESOFT_MAX_ENVIRONMENTS) return { ok: false, error: `List at most ${String(MULESOFT_MAX_ENVIRONMENTS)} environments.` };
  if (environments.some((e) => e.length > 80)) return { ok: false, error: 'An environment name is too long.' };
  return { ok: true, config: { region: region as MulesoftRegion, organizationId, clientId, environments } };
}

// ---------------------------------------------------------------------------
// connector-fetch edge function
// ---------------------------------------------------------------------------

/** `test` only signs in and reads the environment list, to check the settings; `fetch` reads everything and returns the file. */
export type ConnectorFetchMode = 'test' | 'fetch';

export interface ConnectorFetchRequest {
  orgId: UUID;
  kind: ConnectorKind;
  mode: ConnectorFetchMode;
}

export type ConnectorFetchResponse =
  | { status: 'ok'; mode: 'test'; message: string }
  | { status: 'ok'; mode: 'fetch'; fileName: string; text: string; warnings: string[] }
  | { status: 'error'; code: 'invalid' | 'not_found' | 'forbidden' | 'sign_in_failed' | 'no_access' | 'provider' | 'failed'; message: string };
