/**
 * Phase D step 1: everything the `org-ai-key` edge function decides, with its
 * collaborators injected so it is tested without a Deno runtime (the same
 * "thin transport shim" split `ask-model` uses).
 *
 * The function exists because an owner-callable SECURITY DEFINER function would
 * add a Supabase advisor finding (CLAUDE.md rule 9). Instead the database
 * functions are service-role only, and this handler is the one place that
 * checks the caller is an owner of the organisation before using them.
 *
 * Two promises, both tested: the key is never returned or put in an error
 * message, and a caller who is not an owner of that organisation gets the same
 * plain refusal whether or not the organisation exists.
 */
import type { UUID } from '../contracts/delta';

export interface OrgAiKeyDeps {
  /** True when the signed-in caller (their own forwarded session, so RLS decides) is an owner of the organisation. */
  isOwner: (orgId: UUID) => Promise<boolean>;
  /** Service-role: save or replace the key. */
  setKey: (orgId: UUID, key: string) => Promise<void>;
  /** Service-role: remove the key and switch agents off. */
  clearKey: (orgId: UUID) => Promise<void>;
}

export type OrgAiKeyOutcome =
  | { status: 'invalid'; message: string }
  | { status: 'forbidden'; message: string }
  | { status: 'saved' }
  | { status: 'cleared' };

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_ORG_AI_KEY_LENGTH = 512;

export async function handleOrgAiKey(deps: OrgAiKeyDeps, body: unknown): Promise<OrgAiKeyOutcome> {
  if (typeof body !== 'object' || body === null) return { status: 'invalid', message: 'A request body is required.' };
  const r = body as Record<string, unknown>;
  if (typeof r.orgId !== 'string' || !UUID_SHAPE.test(r.orgId)) return { status: 'invalid', message: 'orgId must be an organisation id.' };
  if (r.action !== 'set' && r.action !== 'clear') return { status: 'invalid', message: 'action must be "set" or "clear".' };
  let key = '';
  if (r.action === 'set') {
    if (typeof r.key !== 'string' || r.key.trim() === '') return { status: 'invalid', message: 'Enter the key.' };
    key = r.key.trim();
    if (key.length > MAX_ORG_AI_KEY_LENGTH) return { status: 'invalid', message: 'That key is too long.' };
  }
  if (!(await deps.isOwner(r.orgId))) return { status: 'forbidden', message: 'Only an owner of this organisation can change its AI key.' };
  if (r.action === 'set') {
    await deps.setKey(r.orgId, key);
    return { status: 'saved' };
  }
  await deps.clearKey(r.orgId);
  return { status: 'cleared' };
}
