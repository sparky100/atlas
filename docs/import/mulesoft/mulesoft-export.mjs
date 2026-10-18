#!/usr/bin/env node
/**
 * Exports the architecture-relevant part of an Anypoint Platform org to one
 * JSON file Atlas can import (Capture > Start a capture run > Source:
 * MuleSoft Anypoint). Runs on your own machine with your own CLI login —
 * nothing is sent anywhere, and no secrets are read.
 *
 *   node mulesoft-export.mjs --env Production --out mulesoft-export.json
 *   node mulesoft-export.mjs --env Sandbox --env Production
 *
 * Needs Node 18+ and the Anypoint CLI (`npm install -g anypoint-cli-v4`),
 * already logged in (`anypoint-cli-v4 conf username <you>` etc.). Each
 * environment is selected by setting ANYPOINT_ENV for the CLI call.
 *
 * Only an allow-list of fields is copied into the output (see the two
 * *_FIELDS lists below), so a field the CLI adds later — or anything
 * secret-looking — never reaches the file. Read the output before you
 * upload it anyway.
 *
 * Output shape (version 1), which Atlas's MuleSoft adapter reads:
 *   { format: 'atlas-mulesoft-export', version: 1, exportedAt, organizationId,
 *     environments: [{ name, apis: [...], contracts: { '<apiId>': [...] } }],
 *     warnings: [...] }
 */
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const EXPORT_FORMAT = 'atlas-mulesoft-export';
export const EXPORT_VERSION = 1;

/** API Manager instance fields copied through — names, ids, versions, the backend endpoint, lifecycle. */
export const API_FIELDS = ['id', 'assetId', 'assetVersion', 'productVersion', 'instanceLabel', 'description', 'tags', 'endpointUri', 'endpointType', 'technology', 'status', 'deprecated', 'stage', 'activeContractsCount', 'environmentId', 'organizationId'];

/** Contract fields copied through (the client application is reduced to id and name below). */
export const CONTRACT_FIELDS = ['id', 'status', 'apiId', 'approvedDate', 'rejectedDate', 'revokedDate'];

/** CLI output can carry warning lines (for example a Node deprecation notice, which itself contains a `[`); the JSON starts at the first line that begins with `[` or `{`. */
export function parseCliJson(text, what) {
  const start = text.search(/^[[{]/m);
  if (start === -1) throw new Error(`${what}: the CLI printed no JSON.`);
  try {
    return JSON.parse(text.slice(start));
  } catch (error) {
    throw new Error(`${what}: could not read the CLI's JSON output (${error instanceof Error ? error.message : String(error)}).`);
  }
}

function pick(source, fields) {
  const out = {};
  for (const field of fields) if (source[field] !== undefined) out[field] = source[field];
  return out;
}

export function sanitiseApi(api) {
  return pick(api, API_FIELDS);
}

export function sanitiseContract(contract) {
  const out = pick(contract, CONTRACT_FIELDS);
  const application = contract.application;
  if (application !== null && typeof application === 'object') out.application = pick(application, ['id', 'name']);
  return out;
}

export function parseArgs(argv) {
  const envs = [];
  let out = 'mulesoft-export.json';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env') {
      const value = argv[(i += 1)];
      if (value === undefined || value.startsWith('--')) throw new Error('--env needs an environment name, for example --env Production.');
      envs.push(value);
    } else if (arg === '--out') {
      const value = argv[(i += 1)];
      if (value === undefined || value.startsWith('--')) throw new Error('--out needs a file name.');
      out = value;
    } else {
      throw new Error(`Unknown argument "${arg}". Use --env <name> (repeatable) and --out <file>.`);
    }
  }
  return { envs: envs.length > 0 ? envs : ['Production'], out };
}

/**
 * Collects every environment's API instances and their contracts. `run(args, env)` returns the CLI's stdout
 * for one command; it is injected so this can be tested without a CLI. A failing contract call is recorded
 * in `warnings` and the export carries on — one unreadable API shouldn't lose the rest.
 */
export async function exportEnvironments({ envs, run, now }) {
  const environments = [];
  const warnings = [];
  let organizationId = null;
  for (const name of envs) {
    const apiList = parseCliJson(await run(['api-mgr', 'api', 'list', '--output', 'json'], name), `API list for ${name}`);
    if (!Array.isArray(apiList)) throw new Error(`API list for ${name}: expected a list.`);
    const apis = apiList.map(sanitiseApi);
    const contracts = {};
    for (const api of apis) {
      if (organizationId === null && typeof api.organizationId === 'string') organizationId = api.organizationId;
      try {
        const list = parseCliJson(await run(['api-mgr', 'contract', 'list', String(api.id), '--output', 'json'], name), `contracts for API ${String(api.id)} in ${name}`);
        contracts[String(api.id)] = Array.isArray(list) ? list.map(sanitiseContract) : [];
      } catch (error) {
        contracts[String(api.id)] = [];
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    }
    environments.push({ name, apis, contracts });
  }
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now, organizationId, environments, warnings };
}

async function runCli(args, environmentName) {
  const { stdout } = await execFileAsync('anypoint-cli-v4', args, {
    env: { ...process.env, ANYPOINT_ENV: environmentName },
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function main() {
  const { envs, out } = parseArgs(process.argv.slice(2));
  const result = await exportEnvironments({ envs, run: runCli, now: new Date().toISOString() });
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  const apiCount = result.environments.reduce((total, environment) => total + environment.apis.length, 0);
  console.log(`Wrote ${out}: ${String(apiCount)} API(s) across ${String(result.environments.length)} environment(s).`);
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  console.log('Check the file for anything confidential before uploading it to Atlas.');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
