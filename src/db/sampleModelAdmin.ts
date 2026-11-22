/**
 * Platform-admin sample-model withdrawal reads and writes. The sample rows
 * themselves stay append-only; withdrawal is a separate event history and an
 * RLS rule that hides the whole slug from ordinary users.
 */
import type { SampleModelAdminSummary, SampleModelWithdrawalEventRow } from '../contracts/sampleModelAdmin';
import type { Client } from './client';

interface SampleModelAdminRow {
  slug: string;
  version: number;
  name: string;
  description: string | null;
  created_at: string;
}

export async function listSampleModelsForAdmin(client: Client): Promise<SampleModelAdminSummary[]> {
  const [models, events] = await Promise.all([
    client.from('sample_models')
      .select('slug,version,name,description,created_at')
      .order('slug')
      .order('version', { ascending: false }),
    client.from('sample_model_withdrawal_events')
      .select('id,slug,action,reason,actor_id,happened_at')
      .order('happened_at', { ascending: false }),
  ]);
  if (models.error) throw new Error(`listSampleModelsForAdmin: ${models.error.message}`);
  if (events.error) throw new Error(`listSampleModelsForAdmin: ${events.error.message}`);

  const latest = new Map<string, SampleModelAdminRow>();
  for (const row of (models.data as SampleModelAdminRow[] | null) ?? []) {
    if (!latest.has(row.slug)) latest.set(row.slug, row);
  }
  const eventRows = (events.data as SampleModelWithdrawalEventRow[] | null) ?? [];
  return [...latest.values()].map((row) => {
    const slugEvents = eventRows.filter((event) => event.slug === row.slug);
    const latestEvent = slugEvents[0];
    const lastWithdrawal = slugEvents.find((event) => event.action === 'withdrawn') ?? null;
    const lastReinstatement = slugEvents.find((event) => event.action === 'reinstated') ?? null;
    const shared = latestEvent === undefined || latestEvent.action === 'reinstated';
    return {
      slug: row.slug,
      name: row.name,
      description: row.description,
      latestVersion: row.version,
      publishedAt: row.created_at,
      shared,
      withdrawnAt: lastWithdrawal?.happened_at ?? null,
      withdrawnReason: lastWithdrawal?.reason ?? null,
      reinstatedAt: shared ? (lastReinstatement?.happened_at ?? null) : null,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export async function isSampleModelWithdrawn(client: Client, slug: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('sample_model_withdrawn', { p_slug: slug });
  if (error) throw new Error(`isSampleModelWithdrawn: ${error.message}`);
  return data === true;
}

export async function withdrawSampleModel(client: Client, slug: string, reason: string): Promise<void> {
  const { error } = await client.schema('atlas').rpc('withdraw_sample_model', { p_slug: slug, p_reason: reason });
  if (error) throw new Error(`withdrawSampleModel: ${error.message}`);
}

export async function reinstateSampleModel(client: Client, slug: string, reason: string | null): Promise<void> {
  const { error } = await client.schema('atlas').rpc('reinstate_sample_model', { p_slug: slug, p_reason: reason });
  if (error) throw new Error(`reinstateSampleModel: ${error.message}`);
}
