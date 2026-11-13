/**
 * Reads an Anypoint organisation through its REST APIs and produces the same
 * export file `docs/import/mulesoft/mulesoft-export.mjs` writes
 * (`MulesoftExportFile`, version 1). Everything after that is the existing
 * converter, review queue and apply: this file only replaces "run a script
 * and upload what it wrote".
 *
 * **Unverified against a live Anypoint organisation.** The endpoints and
 * response shapes below are written from MuleSoft's public API Manager and
 * Access Management documentation and are read defensively (every field
 * optional, two shapes accepted where the docs and the CLI differ), but this
 * code has only been exercised against canned responses built from those
 * shapes, never a real tenant. See docs/import/mulesoft/connector.md.
 *
 * Read-only: only GET requests, apart from the one token request. Only an
 * allow-list of fields is copied into the file, the same lists the export
 * script uses, so nothing secret-looking can reach it.
 */
import type { MulesoftConnectorConfig, MulesoftRegion } from '../../contracts/connectors';
import { ConnectorError, type Http, type HttpResponse } from '../http';

export const ANYPOINT_HOSTS: Record<MulesoftRegion, string> = {
  us: 'https://anypoint.mulesoft.com',
  eu: 'https://eu1.anypoint.mulesoft.com',
  gov: 'https://gov.anypoint.mulesoft.com',
};

/** The same allow-lists as the export script (docs/import/mulesoft/mulesoft-export.mjs). */
const API_FIELDS = ['id', 'assetId', 'assetVersion', 'productVersion', 'instanceLabel', 'description', 'tags', 'endpointUri', 'endpointType', 'technology', 'status', 'deprecated', 'stage', 'activeContractsCount', 'environmentId', 'organizationId'] as const;
const CONTRACT_FIELDS = ['id', 'status', 'apiId', 'approvedDate', 'rejectedDate', 'revokedDate'] as const;

const PAGE_SIZE = 100;
/** A hard stop on what one fetch will read from one environment, so a runaway list cannot run for ever. */
export const MAX_APIS_PER_ENVIRONMENT = 2000;
const CONTRACT_CONCURRENCY = 5;

export interface AnypointDeps {
  http: Http;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Stop reading contracts after this many milliseconds and say the export is incomplete (an edge function has a time limit). */
  budgetMs?: number;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function pick(source: Json, fields: readonly string[]): Json {
  const out: Json = {};
  for (const field of fields) if (source[field] !== undefined) out[field] = source[field];
  return out;
}

async function bodyJson(response: HttpResponse): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ConnectorError('provider', 'Anypoint answered with something that is not JSON. Try again in a minute.');
  }
}

/** One GET with a couple of retries for a busy server, and plain errors for the failures people actually hit. */
async function getJson(deps: AnypointDeps, url: string, token: string, what: string): Promise<unknown> {
  let last: ConnectorError | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: HttpResponse;
    try {
      response = await deps.http(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    } catch {
      last = new ConnectorError('provider', `Could not reach Anypoint to read ${what}.`);
      if (attempt < 3) await deps.sleep(1000 * attempt);
      continue;
    }
    if (response.status === 401) throw new ConnectorError('sign_in_failed', 'Anypoint refused the connected app\'s token. Check the client ID and secret.');
    if (response.status === 403) throw new ConnectorError('no_access', `The connected app is not allowed to read ${what}. In Anypoint, give it read access to API Manager and Access Management for this organisation and environment.`);
    if (response.status === 404) throw new ConnectorError('no_access', `Anypoint could not find ${what}. Check the organisation ID and environment name.`);
    if (response.status === 429 || response.status >= 500) {
      last = new ConnectorError('provider', `Anypoint was busy while reading ${what} (status ${String(response.status)}).`);
      if (attempt < 3) await deps.sleep(2000 * attempt);
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new ConnectorError('provider', `Anypoint answered ${String(response.status)} while reading ${what}.`);
    return bodyJson(response);
  }
  throw last ?? new ConnectorError('provider', `Could not read ${what}.`);
}

/** Exchanges the connected app's client credentials for a short-lived token. The secret is only ever in this one request. */
export async function signIn(deps: AnypointDeps, region: MulesoftRegion, clientId: string, clientSecret: string): Promise<string> {
  let response: HttpResponse;
  try {
    response = await deps.http(`${ANYPOINT_HOSTS[region]}/accounts/api/v2/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    });
  } catch {
    throw new ConnectorError('provider', 'Could not reach Anypoint. Check the region and try again.');
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new ConnectorError('sign_in_failed', 'Anypoint refused the client ID and secret. Check them, and that the connected app is for client credentials in this region.');
  }
  if (response.status < 200 || response.status >= 300) throw new ConnectorError('provider', `Anypoint answered ${String(response.status)} when signing in.`);
  const json = await bodyJson(response);
  const token = isObject(json) ? json.access_token : undefined;
  if (typeof token !== 'string' || token === '') throw new ConnectorError('provider', 'Anypoint signed the app in but sent no token.');
  return token;
}

export interface AnypointEnvironment {
  id: string;
  name: string;
}

export async function listEnvironments(deps: AnypointDeps, config: MulesoftConnectorConfig, token: string): Promise<AnypointEnvironment[]> {
  const json = await getJson(deps, `${ANYPOINT_HOSTS[config.region]}/accounts/api/organizations/${encodeURIComponent(config.organizationId)}/environments`, token, 'the environment list');
  const rows = isObject(json) && Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  return rows.flatMap((row) => (isObject(row) && typeof row.id === 'string' && typeof row.name === 'string' ? [{ id: row.id, name: row.name }] : []));
}

/** API Manager lists instances grouped by asset (`assets[].apis[]`); a flat `apis[]` is accepted too. */
function apisFromPage(json: unknown): Json[] {
  if (!isObject(json)) return [];
  if (Array.isArray(json.assets)) return json.assets.flatMap((asset) => (isObject(asset) && Array.isArray(asset.apis) ? asset.apis.filter(isObject).map((api) => ({ assetId: asset.assetId, ...api })) : []));
  if (Array.isArray(json.apis)) return json.apis.filter(isObject);
  return [];
}

export function sanitiseApi(api: Json): Json {
  const out = pick(api, API_FIELDS);
  const endpoint = isObject(api.endpoint) ? api.endpoint : null;
  if (out.endpointUri === undefined && endpoint !== null && typeof endpoint.uri === 'string') out.endpointUri = endpoint.uri;
  if (out.endpointType === undefined && endpoint !== null && typeof endpoint.type === 'string') out.endpointType = endpoint.type;
  return out;
}

export function sanitiseContract(contract: Json): Json {
  const out = pick(contract, CONTRACT_FIELDS);
  if (isObject(contract.application)) out.application = pick(contract.application, ['id', 'name']);
  return out;
}

async function listApis(deps: AnypointDeps, config: MulesoftConnectorConfig, token: string, envId: string, envName: string, warnings: string[]): Promise<Json[]> {
  const apis: Json[] = [];
  for (let offset = 0; offset < MAX_APIS_PER_ENVIRONMENT; offset += PAGE_SIZE) {
    const url = `${ANYPOINT_HOSTS[config.region]}/apimanager/api/v1/organizations/${encodeURIComponent(config.organizationId)}/environments/${encodeURIComponent(envId)}/apis?limit=${String(PAGE_SIZE)}&offset=${String(offset)}`;
    const page = apisFromPage(await getJson(deps, url, token, `the API list for ${envName}`));
    apis.push(...page.map(sanitiseApi));
    if (page.length < PAGE_SIZE) return apis;
  }
  warnings.push(`${envName}: stopped after ${String(MAX_APIS_PER_ENVIRONMENT)} APIs, so the export is incomplete.`);
  return apis;
}

async function listContracts(deps: AnypointDeps, config: MulesoftConnectorConfig, token: string, envId: string, apiId: string): Promise<Json[]> {
  const out: Json[] = [];
  for (let offset = 0; offset < 5000; offset += PAGE_SIZE) {
    const url = `${ANYPOINT_HOSTS[config.region]}/apimanager/api/v1/organizations/${encodeURIComponent(config.organizationId)}/environments/${encodeURIComponent(envId)}/apis/${encodeURIComponent(apiId)}/contracts?limit=${String(PAGE_SIZE)}&offset=${String(offset)}`;
    const json = await getJson(deps, url, token, `the contracts of API ${apiId}`);
    const rows = isObject(json) && Array.isArray(json.contracts) ? json.contracts : Array.isArray(json) ? json : [];
    const page = rows.filter(isObject).map(sanitiseContract);
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

export interface MulesoftExportDocument {
  format: 'atlas-mulesoft-export';
  version: 1;
  exportedAt: string;
  organizationId: string;
  environments: { name: string; apis: Json[]; contracts: Record<string, Json[]> }[];
  warnings: string[];
}

/** Reads every configured environment and returns the export document. A contract list that cannot be read becomes a warning, not a failure: one unreadable API should not lose the rest. */
export async function fetchMulesoftExport(deps: AnypointDeps, config: MulesoftConnectorConfig, clientSecret: string): Promise<MulesoftExportDocument> {
  const started = deps.now().getTime();
  const budgetMs = deps.budgetMs ?? 100_000;
  const token = await signIn(deps, config.region, config.clientId, clientSecret);
  const available = await listEnvironments(deps, config, token);
  const warnings: string[] = [];
  const environments: MulesoftExportDocument['environments'] = [];

  for (const name of config.environments) {
    const environment = available.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (environment === undefined) {
      warnings.push(`${name}: Anypoint has no environment with that name${available.length > 0 ? ` (it has: ${available.map((e) => e.name).join(', ')})` : ''}, so it was skipped.`);
      continue;
    }
    const apis = await listApis(deps, config, token, environment.id, environment.name, warnings);
    if (apis.length === 0) warnings.push(`${environment.name}: API Manager listed no APIs here. Check the environment, and that the connected app can read API Manager in it.`);

    const contracts: Record<string, Json[]> = {};
    const queue = [...apis];
    let skipped = 0;
    const worker = async (): Promise<void> => {
      for (let api = queue.shift(); api !== undefined; api = queue.shift()) {
        const apiId = String(api.id);
        if (deps.now().getTime() - started > budgetMs) {
          contracts[apiId] = [];
          skipped += 1;
          continue;
        }
        try {
          contracts[apiId] = await listContracts(deps, config, token, environment.id, apiId);
        } catch (error) {
          contracts[apiId] = [];
          warnings.push(`Contracts for API ${apiId} in ${environment.name} could not be read, so its client applications are missing: ${error instanceof Error ? error.message : 'unknown problem'}`);
          if (error instanceof ConnectorError && error.code === 'sign_in_failed') throw error;
        }
      }
    };
    await Promise.all(Array.from({ length: CONTRACT_CONCURRENCY }, worker));
    if (skipped > 0) warnings.push(`${environment.name}: ran out of time, so ${String(skipped)} API(s) have no contracts and their client applications are missing. Fetch again, or use the export script for a large organisation.`);
    environments.push({ name: environment.name, apis, contracts });
  }

  if (environments.length === 0) throw new ConnectorError('no_access', `None of the environments you listed exist in this organisation.${available.length > 0 ? ` Anypoint has: ${available.map((e) => e.name).join(', ')}.` : ''}`);
  return { format: 'atlas-mulesoft-export', version: 1, exportedAt: deps.now().toISOString(), organizationId: config.organizationId, environments, warnings };
}
