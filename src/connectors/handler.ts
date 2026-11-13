/**
 * Everything the `connector-fetch` edge function decides, with its
 * collaborators injected so it is tested without a Deno runtime.
 *
 * Order matters: the caller must be able to read the organisation's connector
 * (row-level security: owners and architects) before the secret is touched,
 * and the secret is read only by the service role, only here, only for the
 * one connector found. Nothing is written except the "last fetch" note.
 * The secret is never returned and never put in an error message.
 */
import { CONNECTOR_KINDS, type ConnectorFetchRequest, type ConnectorFetchResponse, type ConnectorKind, type ConnectorRow } from '../contracts/connectors';
import { connectorByKind, type ConnectorRuntime } from './registry';
import { ConnectorError } from './http';

export interface ConnectorHandlerDeps {
  /** Read with the caller's own session: a connector the caller cannot read is `null`. */
  loadConnector: (orgId: string, kind: ConnectorKind) => Promise<ConnectorRow | null>;
  /** Service role only. */
  readSecret: (connectorId: string) => Promise<string | null>;
  recordOutcome: (connectorId: string, status: 'ok' | 'error', message: string) => Promise<void>;
  runtime: ConnectorRuntime;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseConnectorFetchBody(body: unknown): ConnectorFetchRequest | string {
  if (typeof body !== 'object' || body === null) return 'A request body is required.';
  const r = body as Record<string, unknown>;
  if (typeof r.orgId !== 'string' || !UUID_SHAPE.test(r.orgId)) return 'orgId must be an organisation id.';
  if (typeof r.kind !== 'string' || !(CONNECTOR_KINDS as readonly string[]).includes(r.kind)) return 'kind must be a known connector.';
  if (r.mode !== 'test' && r.mode !== 'fetch') return 'mode must be "test" or "fetch".';
  return { orgId: r.orgId, kind: r.kind as ConnectorKind, mode: r.mode };
}

function errorMessage(error: unknown): { code: 'sign_in_failed' | 'no_access' | 'provider' | 'failed'; message: string } {
  if (error instanceof ConnectorError) return { code: error.code, message: error.message };
  return { code: 'failed', message: error instanceof Error ? error.message : 'Something went wrong fetching from the other tool.' };
}

export async function handleConnectorFetch(deps: ConnectorHandlerDeps, body: unknown): Promise<ConnectorFetchResponse> {
  const parsed = parseConnectorFetchBody(body);
  if (typeof parsed === 'string') return { status: 'error', code: 'invalid', message: parsed };

  const definition = connectorByKind(parsed.kind);
  if (!definition) return { status: 'error', code: 'invalid', message: 'kind must be a known connector.' };

  const connector = await deps.loadConnector(parsed.orgId, parsed.kind);
  if (!connector) return { status: 'error', code: 'not_found', message: 'This connector is not set up, or you are not allowed to use it.' };

  const valid = definition.validateConfig(connector.config);
  if (!valid.ok) return { status: 'error', code: 'invalid', message: valid.error };

  const secret = await deps.readSecret(connector.id);
  if (secret === null || secret === '') return { status: 'error', code: 'invalid', message: 'The saved secret is missing. Enter it again in Organisation settings.' };

  try {
    if (parsed.mode === 'test') {
      const message = await definition.test(deps.runtime, connector.config, secret);
      await deps.recordOutcome(connector.id, 'ok', message);
      return { status: 'ok', mode: 'test', message };
    }
    const file = await definition.fetch(deps.runtime, connector.config, secret);
    await deps.recordOutcome(connector.id, 'ok', file.warnings.length > 0 ? `Fetched, with ${String(file.warnings.length)} warning(s).` : 'Fetched.');
    return { status: 'ok', mode: 'fetch', fileName: file.fileName, text: file.text, warnings: file.warnings };
  } catch (error) {
    const { code, message } = errorMessage(error);
    await deps.recordOutcome(connector.id, 'error', message);
    return { status: 'error', code, message };
  }
}
