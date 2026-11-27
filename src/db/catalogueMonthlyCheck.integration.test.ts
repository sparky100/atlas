/**
 * Catalogue step 5b-2, real database: the monthly switch and the run record are
 * platform-admin only, the server stamps who and when, a browser cannot start a
 * "monthly" run or rewrite who started one, and nobody signed in can read the
 * schedule secret or call the monthly job's function.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceRoleClient, createSupabaseClient, type Client } from './client';
import { loadEnv } from './env';
import { finishCheckRun, getCheckSchedule, listCheckRuns, setCheckSchedule, startCheckRun } from './catalogueAdmin';

const env = loadEnv();
const service = createServiceRoleClient(env);

function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

async function signedIn(label: string): Promise<{ id: string; client: Client }> {
  const email = `monthly-check-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: created.data.user.id, client };
}

describe('catalogue monthly check, real database', () => {
  let admin: { id: string; client: Client };
  let outside: { id: string; client: Client };
  const runIds: string[] = [];

  beforeAll(async () => {
    admin = await signedIn('admin');
    outside = await signedIn('outside');
    check(await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null }));
    check(await service.from('catalogue_check_schedule').update({ enabled: false }).eq('id', true));
  });

  afterAll(async () => {
    check(await service.from('catalogue_check_schedule').update({ enabled: false }).eq('id', true));
  });

  it('starts switched off, and an admin switching it is stamped by the server', async () => {
    expect((await getCheckSchedule(admin.client)).enabled).toBe(false);
    await setCheckSchedule(admin.client, true);
    const after = await getCheckSchedule(admin.client);
    expect(after.enabled).toBe(true);
    expect(after.switchedByName).toBeTruthy();
    expect(after.switchedAt).not.toBeNull();
    const stored = await service.from('catalogue_check_schedule').select('switched_by').single();
    expect((stored.data as { switched_by: string }).switched_by).toBe(admin.id);

    // Naming someone else is refused: only the switch itself can be written from a browser.
    const forged = await admin.client.from('catalogue_check_schedule').update({ switched_by: outside.id }).eq('id', true);
    expect(forged.error).not.toBeNull();
    await setCheckSchedule(admin.client, false);
    expect((await getCheckSchedule(admin.client)).enabled).toBe(false);
  });

  it('records a manual run with the server\'s name and time, and the end time comes from the server', async () => {
    const id = await startCheckRun(admin.client, 'claims');
    runIds.push(id);
    let runs = await listCheckRuns(admin.client, 20);
    let run = runs.find((candidate) => candidate.id === id);
    expect(run).toMatchObject({ kind: 'manual', scope: 'claims', status: 'running', finishedAt: null });
    expect(run?.startedByName).toBeTruthy();
    const stored = await service.from('catalogue_check_runs').select('started_by').eq('id', id).single();
    expect((stored.data as { started_by: string }).started_by).toBe(admin.id);

    await finishCheckRun(admin.client, id, { status: 'finished', linksChecked: 0, claimsChecked: 5, flagged: 2, tokens: { input: 900, output: 40 }, note: null });
    runs = await listCheckRuns(admin.client, 20);
    run = runs.find((candidate) => candidate.id === id);
    expect(run).toMatchObject({ status: 'finished', claimsChecked: 5, flagged: 2, tokens: 940 });
    expect(run?.finishedAt).not.toBeNull();

    // Who started it cannot be rewritten from the browser.
    const rewrite = await admin.client.from('catalogue_check_runs').update({ started_by_name: 'Somebody Else' }).eq('id', id);
    expect(rewrite.error).not.toBeNull();
  });

  it('refuses a browser starting a monthly run, and lets the service role record one', async () => {
    const monthly = await admin.client.from('catalogue_check_runs').insert({ kind: 'monthly', scope: 'both' });
    expect(monthly.error).not.toBeNull();

    const inserted = await service.from('catalogue_check_runs').insert({ kind: 'monthly', scope: 'both', started_by: admin.id, started_by_name: 'Monthly check (switched on by Test)' }).select('id').single();
    check(inserted);
    const id = (inserted.data as { id: string }).id;
    runIds.push(id);
    const shown = (await listCheckRuns(admin.client, 20)).find((candidate) => candidate.id === id);
    expect(shown).toMatchObject({ kind: 'monthly', scope: 'both', startedByName: 'Monthly check (switched on by Test)' });
    // An admin cannot edit a monthly run's record either.
    const edit = await admin.client.from('catalogue_check_runs').update({ status: 'failed' }).eq('id', id).select();
    expect((edit.data as unknown[] | null) ?? []).toEqual([]);
  });

  it('shows and accepts nothing from a signed-in user who is not a platform admin, or from a signed-out caller', async () => {
    expect((await listCheckRuns(outside.client, 50)).filter((row) => runIds.includes(row.id))).toEqual([]);
    await expect(startCheckRun(outside.client, 'links')).rejects.toThrow();
    await expect(setCheckSchedule(outside.client, true)).rejects.toThrow();
    expect((await getCheckSchedule(outside.client)).enabled).toBe(false);
    const stored = await service.from('catalogue_check_schedule').select('enabled').single();
    expect((stored.data as { enabled: boolean }).enabled).toBe(false);

    const anon = createSupabaseClient(env);
    const read = await anon.from('catalogue_check_runs').select('id');
    expect(((read.data as unknown[] | null) ?? []).length).toBe(0);
    const write = await anon.from('catalogue_check_schedule').update({ enabled: true }).eq('id', true).select();
    expect(((write.data as unknown[] | null) ?? []).length).toBe(0);
  });

  it('keeps the schedule secret and the monthly job unreachable for every signed-in caller', async () => {
    for (const who of [admin, outside]) {
      const secret = await who.client.schema('atlas').rpc('catalogue_schedule_secret');
      expect(secret.error).not.toBeNull();
      const job = await who.client.schema('atlas').rpc('run_monthly_catalogue_check');
      expect(job.error).not.toBeNull();
    }
    const anon = createSupabaseClient(env);
    expect((await anon.schema('atlas').rpc('catalogue_schedule_secret')).error).not.toBeNull();
    const fromService = await service.schema('atlas').rpc('catalogue_schedule_secret');
    expect(fromService.error).toBeNull();
    expect(typeof fromService.data).toBe('string');
  });
});
