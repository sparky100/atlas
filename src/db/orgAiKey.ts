import type { UUID } from '../contracts/delta';
import type { Client } from './client';

/**
 * Phase D step 1: save or remove the organisation's own AI key (for agents)
 * through the `org-ai-key` edge function, which checks the caller is an owner.
 * The key goes up once and is never returned: the page only ever learns
 * whether one is set (`organisations.ai_agent_key_set`).
 */
async function callOrgAiKey(supabase: Client, body: { orgId: UUID; action: 'set' | 'clear'; key?: string }): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see invites.ts.
  const { data, error } = await supabase.functions.invoke('org-ai-key', { body });
  if (error) throw new Error('Could not reach the key service. Check that it has been deployed, then try again.');
  const result = data as { status?: string; message?: string } | null;
  if (result?.status === 'saved' || result?.status === 'cleared') return;
  throw new Error(typeof result?.message === 'string' ? result.message : 'The key service gave no answer.');
}

export function saveOrgAiKey(supabase: Client, orgId: UUID, key: string): Promise<void> {
  return callOrgAiKey(supabase, { orgId, action: 'set', key });
}

export function removeOrgAiKey(supabase: Client, orgId: UUID): Promise<void> {
  return callOrgAiKey(supabase, { orgId, action: 'clear' });
}
