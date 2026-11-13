/**
 * Everything the `api` edge function decides (docs/ADR-031-read-only-api.md),
 * with its collaborators injected so it is tested without a Deno runtime (the
 * "thin transport shim" split `ask-model` and `capture-run` use).
 *
 * Read-only by construction: only GET (and HEAD) are routed, every read goes
 * through the same `ToolContext` readers Ask Atlas uses, always at the head
 * of a model's main line. Order matters: a request is authenticated and
 * counted against the key's rate limit before anything is looked up, and a
 * model is only found among the key's own organisation's models, so another
 * organisation's id is simply "not found".
 */
import { z } from 'zod';
import { RELATIONSHIP_TYPES, ELEMENT_TYPES, type UUID } from '../contracts/delta';
import type { ApiCapability, ApiElement, ApiElementDetail, ApiError, ApiFindingElement, ApiFindingSummary, ApiItem, ApiList, ApiMeta, ApiModel, ApiRelationship } from '../contracts/api';
import { API_VERSION } from '../contracts/api';
import type { ElementsHeadRow } from '../contracts/rows';
import { FINDING_FILTER_OPTIONS } from '../db/elementBrowse';
import { computeFindings } from '../db/modelFindings';
import type { ToolContext } from '../tools/types';
import { displayNameOf, indexSnapshot } from '../tools/toolKit';
import { hashApiKey, parseBearerKey } from './apiKey';
import { decodeCursor, pageOf, parseLimit } from './pagination';

export interface ApiAuthorization {
  keyId: UUID;
  orgId: UUID;
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface ApiHandlerDeps {
  /** `null` for an unknown or revoked key. Counts the request against the key's rate limit. */
  authorize: (keyHash: string) => Promise<ApiAuthorization | null>;
  /** The organisation's models that are not archived. */
  listModels: (orgId: UUID) => Promise<(ApiModel & { orgId: UUID })[]>;
  /** Head commit of the model's main line, or `null` when it has none. */
  mainCommit: (modelId: UUID) => Promise<UUID | null>;
  createContext: (model: { id: UUID; name: string }, commitId: UUID) => ToolContext;
}

export interface ApiRequest {
  method: string;
  /** The path after the function's own mount point, e.g. `/v1/models`. */
  path: string;
  query: URLSearchParams;
  authorization: string | null;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const FINDINGS = FINDING_FILTER_OPTIONS.filter((o) => o.value !== '');
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_TYPE_FILTER = z.enum(ELEMENT_TYPES);
const RELATIONSHIP_TYPE_FILTER = z.enum(RELATIONSHIP_TYPES);

function fail(status: number, code: ApiError['error']['code'], message: string, headers: Record<string, string> = {}): ApiResponse {
  const body: ApiError = { error: { code, message } };
  return { status, headers, body };
}
const badRequest = (message: string) => fail(400, 'bad_request', message);
const notFound = (message: string) => fail(404, 'not_found', message);

function elementOf(index: ReturnType<typeof indexSnapshot>, e: ElementsHeadRow): ApiElement {
  return { id: e.element_id, type: e.element_type, name: displayNameOf(index, e), parent_id: e.parent_id, attributes: e.attributes };
}

interface Paging {
  limit: number;
  after: string | null;
}
function paging(query: URLSearchParams): Paging | ApiResponse {
  const limit = parseLimit(query.get('limit'));
  if (limit === null) return badRequest('limit must be a whole number from 1 to 200.');
  const after = decodeCursor(query.get('cursor'));
  if (!after.ok) return badRequest('cursor is not one this API returned.');
  return { limit, after: after.value };
}
const isResponse = (v: Paging | ApiResponse): v is ApiResponse => 'status' in v;

export async function handleApiRequest(deps: ApiHandlerDeps, req: ApiRequest): Promise<ApiResponse> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'method_not_allowed', 'This API is read-only: only GET is supported.', { Allow: 'GET, HEAD' });

  const token = parseBearerKey(req.authorization);
  if (token === null) return fail(401, 'unauthorized', 'Send your API key as "Authorization: Bearer atl_…".', { 'WWW-Authenticate': 'Bearer' });
  const auth = await deps.authorize(await hashApiKey(token));
  if (auth === null) return fail(401, 'unauthorized', 'That API key is not valid, or has been revoked.', { 'WWW-Authenticate': 'Bearer' });
  if (!auth.allowed) return fail(429, 'rate_limited', 'Too many requests for this key. Wait and retry.', { 'Retry-After': String(auth.retryAfterSeconds) });

  const parts = req.path.split('/').filter((p) => p !== '');
  if (parts[0] !== API_VERSION) return notFound(`Unknown path. This API's endpoints start with /${API_VERSION}.`);
  const [, resource, modelRef, sub, subId] = parts;
  if (resource !== 'models' || parts.length > 5) return notFound('Unknown path.');

  const models = await deps.listModels(auth.orgId);
  const meta: ApiMeta = { api_version: API_VERSION };

  if (modelRef === undefined) {
    const p = paging(req.query);
    if (isResponse(p)) return p;
    const { items, page } = pageOf(models, (m) => m.id, p.after, p.limit);
    const body: ApiList<ApiModel> = { data: items.map(({ id, name, slug, description }) => ({ id, name, slug, description })), page, meta };
    return { status: 200, headers: {}, body };
  }

  const model = models.find((m) => m.id === modelRef || m.slug === modelRef);
  if (!model) return notFound('No model with that id or slug in your organisation.');
  const commitId = await deps.mainCommit(model.id);
  if (commitId === null) return fail(404, 'empty_model', 'This model has no data yet.');
  const ctx = deps.createContext({ id: model.id, name: model.name }, commitId);
  const modelMeta: ApiMeta = { api_version: API_VERSION, model: { id: model.id, name: model.name }, commit_id: commitId };

  if (sub === undefined) {
    const body: ApiItem<ApiModel> = { data: { id: model.id, name: model.name, slug: model.slug, description: model.description }, meta: modelMeta };
    return { status: 200, headers: {}, body };
  }

  const snapshot = await ctx.snapshot();
  const index = indexSnapshot(snapshot);

  if (sub === 'elements' && subId === undefined) {
    const p = paging(req.query);
    if (isResponse(p)) return p;
    const typeRaw = req.query.get('type');
    const type = typeRaw === null ? null : MODEL_TYPE_FILTER.safeParse(typeRaw);
    if (type !== null && !type.success) return badRequest(`type must be one of: ${ELEMENT_TYPES.join(', ')}.`);
    const q = req.query.get('q')?.trim().toLowerCase() ?? '';
    if (q.length > 200) return badRequest('q must be at most 200 characters.');
    const rows = snapshot.elements.filter((e) => (type === null || e.element_type === type.data) && (q === '' || displayNameOf(index, e).toLowerCase().includes(q)));
    const { items, page } = pageOf(rows, (e) => e.element_id, p.after, p.limit);
    const body: ApiList<ApiElement> = { data: items.map((e) => elementOf(index, e)), page, meta: modelMeta };
    return { status: 200, headers: {}, body };
  }

  if (sub === 'elements' && subId !== undefined) {
    const element = UUID_SHAPE.test(subId) ? index.byId.get(subId.toLowerCase()) : undefined;
    if (!element) return notFound('No element with that id in this model.');
    const facts = await ctx.factsFor(element.element_id);
    const data: ApiElementDetail = {
      ...elementOf(index, element),
      aliases: [...(snapshot.aliases.get(element.element_id) ?? [])].sort(),
      facts: facts
        .map((f) => ({ attribute: f.attribute, value: f.value, source_id: f.source_id, source_ref: f.source_ref, confidence: f.confidence, effective_date: f.effective_date, asserted_at: f.asserted_at }))
        .sort((a, b) => a.attribute.localeCompare(b.attribute)),
    };
    const body: ApiItem<ApiElementDetail> = { data, meta: modelMeta };
    return { status: 200, headers: {}, body };
  }

  if (sub === 'capabilities' && subId === undefined) {
    const p = paging(req.query);
    if (isResponse(p)) return p;
    const supporters = new Map<UUID, UUID[]>();
    for (const r of snapshot.relationships) {
      if (r.relationship_type !== 'supports') continue;
      const list = supporters.get(r.to_element_id);
      if (list) list.push(r.from_element_id);
      else supporters.set(r.to_element_id, [r.from_element_id]);
    }
    const rows = snapshot.elements.filter((e) => e.element_type === 'capability');
    const { items, page } = pageOf(rows, (e) => e.element_id, p.after, p.limit);
    const data: ApiCapability[] = items.map((e) => ({ id: e.element_id, name: e.name, parent_id: e.parent_id, attributes: e.attributes, supported_by: [...(supporters.get(e.element_id) ?? [])].sort() }));
    const body: ApiList<ApiCapability> = { data, page, meta: modelMeta };
    return { status: 200, headers: {}, body };
  }

  if (sub === 'relationships' && subId === undefined) {
    const p = paging(req.query);
    if (isResponse(p)) return p;
    const typeRaw = req.query.get('type');
    const type = typeRaw === null ? null : RELATIONSHIP_TYPE_FILTER.safeParse(typeRaw);
    if (type !== null && !type.success) return badRequest(`type must be one of: ${RELATIONSHIP_TYPES.join(', ')}.`);
    const elementRaw = req.query.get('element');
    if (elementRaw !== null && !UUID_SHAPE.test(elementRaw)) return badRequest('element must be an element id.');
    const rows = snapshot.relationships.filter((r) => (type === null || r.relationship_type === type.data) && (elementRaw === null || r.from_element_id === elementRaw.toLowerCase() || r.to_element_id === elementRaw.toLowerCase()));
    const { items, page } = pageOf(rows, (r) => r.relationship_id, p.after, p.limit);
    const data: ApiRelationship[] = items.map((r) => ({ id: r.relationship_id, type: r.relationship_type, from_element_id: r.from_element_id, to_element_id: r.to_element_id, attributes: r.attributes }));
    const body: ApiList<ApiRelationship> = { data, page, meta: modelMeta };
    return { status: 200, headers: {}, body };
  }

  if (sub === 'findings') {
    const findings = computeFindings({ snapshot, facts: await ctx.allFacts(), retiredByOpenChanges: await ctx.retiredByOpenChanges(), now: ctx.now() });
    if (subId === undefined) {
      const p = paging(req.query);
      if (isResponse(p)) return p;
      const all: ApiFindingSummary[] = FINDINGS.map((o) => ({ key: o.value, label: o.label, count: findings.get(o.value)?.length ?? 0 }));
      const { items, page } = pageOf(all, (f) => f.key, p.after, p.limit);
      const body: ApiList<ApiFindingSummary> = { data: items, page, meta: modelMeta };
      return { status: 200, headers: {}, body };
    }
    if (!FINDINGS.some((o) => o.value === subId)) return notFound(`No finding "${subId.slice(0, 60)}". List them at /${API_VERSION}/models/${modelRef}/findings.`);
    const p = paging(req.query);
    if (isResponse(p)) return p;
    const { items, page } = pageOf(findings.get(subId) ?? [], (e) => e.element_id, p.after, p.limit);
    const data: ApiFindingElement[] = items.map((e) => ({ id: e.element_id, type: e.element_type, name: displayNameOf(index, e) }));
    const body: ApiList<ApiFindingElement> = { data, page, meta: modelMeta };
    return { status: 200, headers: {}, body };
  }

  return notFound('Unknown path.');
}
