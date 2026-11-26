/** Real Supabase/RLS tests. Test-only fixture data never enters the live app. */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOGUE_NO_PRICE_PATTERN, containsCataloguePrice } from '../contracts/productCatalogue';
import type { CatalogueCitation, ProductCatalogueContent } from '../contracts/productCatalogue';
import type { DecisionOptionMark } from '../contracts/decisionOptionMark';
import { catalogueFixture } from '../contracts/fixtures/productCatalogue';
import { createServiceRoleClient, createSupabaseClient } from './client';
import type { Client } from './client';
import { loadEnv } from './env';
import { createOrganisation } from './organisations';
import { createModel } from './models';
import { createDecision, createDecisionLink } from './decisions';
import { createChangeBranch, getMainBranch } from './branches';
import { markOptionEdited } from './decisionOptionMarks';
import { addDesignerCandidate, createDecisionOption, getDecisionOptionForBranch, listDecisionOptions, workOnDecisionOption } from './decisionOptions';
import { addOptionWithCatalogueSources, insertOptionCatalogueSource, catalogueToRows, catalogueSnapshotFromRows, listCatalogueSources, listOptionSources, publishedCapabilityMatchForModel, publishedMapItemForCapability } from './productCatalogue';
import { listOptionWebSources } from './optionWebSources';

function at<T>(items: readonly T[], index = 0): T {
  const value = items[index];
  if (value === undefined) throw new Error('Missing test fixture item');
  return value;
}

const env = loadEnv();
const service = createServiceRoleClient(env);
const anon = createSupabaseClient(env);
interface User { id: string; client: Client }
function check(result: { error: { message: string } | null }): void { if (result.error) throw new Error(result.error.message); }
async function user(label: string): Promise<User> {
  const email = `catalogue-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const result = await service.auth.admin.createUser({ email, password, email_confirm: true });
  check(result);
  if (!result.data.user) throw new Error('No test user');
  const client = createSupabaseClient(env);
  check(await client.auth.signInWithPassword({ email, password }));
  return { id: result.data.user.id, client };
}

// Two actual DB sessions on the same local stack used by the integration suite.
// No extra client dependency; Docker/psql are already required by db:start/CI.
function sqlSession() {
  const child = spawn('docker', ['exec', '-i', 'supabase_db_atlas', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres']);
  let output = '';
  let errors = '';
  child.stdout.on('data', (v: Buffer) => { output += v.toString(); });
  child.stderr.on('data', (v: Buffer) => { errors += v.toString(); });
  const done = new Promise<{ code: number | null; output: string; errors: string }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => { resolve({ code, output, errors }); });
  });
  return {
    done,
    send(sql: string) { child.stdin.write(`${sql}\n`); },
    finish(sql = '') { child.stdin.end(`${sql}\n`); },
    async barrier(sql: string) {
      const marker = `ready_${randomUUID().replaceAll('-', '')}`;
      const reached = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error(`SQL barrier timed out: ${errors}`)); }, 10_000);
        const listen = () => { if (output.includes(marker)) { clearTimeout(timer); child.stdout.off('data', listen); resolve(); } };
        child.stdout.on('data', listen);
        child.once('close', () => { clearTimeout(timer); if (!output.includes(marker)) reject(new Error(errors || 'SQL session closed')); });
      });
      child.stdin.write(`${sql}\n\\echo ${marker}\n`);
      await reached;
    },
  };
}
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;

describe('product catalogue and option evidence, real database', () => {
  let owner: User; let contributor: User; let viewer: User; let outsider: User;
  let orgId: string; let modelId: string;
  beforeAll(async () => {
    [owner, contributor, viewer, outsider] = await Promise.all(['owner', 'contributor', 'viewer', 'outsider'].map(user)) as [User, User, User, User];
    orgId = randomUUID(); modelId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Catalogue Org', slug: `cat-${orgId}`, createdBy: owner.id });
    await createModel(owner.client, { id: modelId, orgId, name: 'Catalogue Model', slug: `cat-${modelId}`, createdBy: owner.id });
    check(await owner.client.from('members').insert([
      { org_id: orgId, user_id: contributor.id, role: 'contributor', invited_by: owner.id },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id },
    ]));
    const otherOrg = randomUUID();
    await createOrganisation(outsider.client, { id: otherOrg, name: 'Different Org', slug: `cat-${otherOrg}`, createdBy: outsider.id });
  });
  afterAll(async () => { await Promise.all([owner, contributor, viewer, outsider].filter(Boolean).map((u) => u.client.auth.signOut())); });

  async function seed(content: ProductCatalogueContent = structuredClone(catalogueFixture), sector?: string, seedMap = true) {
    const rows = catalogueToRows(content, randomUUID, '2026-11-20T10:00:00Z');
    // Unique synthetic sectors avoid coupling tests to editorial content. No
    // hyphens: the catalogue's no-price check treats a hyphen as a word
    // boundary, so a random UUID segment such as "cad" or "aud" would look
    // like a currency code and make this fixture randomly fail.
    let randomSector = `test_${randomUUID().replaceAll('-', '')}`;
    while (containsCataloguePrice(randomSector)) randomSector = `test_${randomUUID().replaceAll('-', '')}`;
    rows.catalogue.sector = sector ?? randomSector;
    const mapId = randomUUID();
    if (seedMap) {
      check(await service.from('capability_maps').insert({ id: mapId, sector: rows.catalogue.sector, version: content.capabilityMapVersion,
        status: 'draft', source_description: 'Test map' }));
      const capabilities = at(content.entries).capabilities;
      check(await service.from('capability_map_items').insert(capabilities.map((c, i) => ({ id: randomUUID(), map_id: mapId, code: c.code,
        name: c.name, level: 1, parent_code: null, item_order: (i + 1) * 10 }))));
      check(await service.from('capability_maps').update({ status: 'published', published_at: '2026-11-20T10:00:00Z' }).eq('id', mapId));
    }
    check(await service.from('product_catalogues').insert(rows.catalogue));
    check(await service.from('catalogue_entries').insert(rows.entries));
    check(await service.from('catalogue_entry_capabilities').insert(rows.capabilities));
    check(await service.from('catalogue_claims').insert(rows.claims));
    return { rows, mapId, id: rows.catalogue.id, entryId: at(rows.entries).id,
      citation: { sector: rows.catalogue.sector, version: content.version, entryCode: at(content.entries).code } satisfies CatalogueCitation };
  }
  const publish = (id: string) => service.from('product_catalogues').update({ status: 'published', published_at: '2026-11-20T10:00:00Z' }).eq('id', id);

  it('finds a capability by code in the current published map when its seeded item id is stale', async () => {
    const s = await seed();
    check(await service.from('sources').delete().eq('model_id', modelId).eq('kind', 'template'));
    check(await service.from('sources').insert({ id: randomUUID(), org_id: orgId, model_id: modelId, kind: 'template', name: 'Test map', capability_map_id: s.mapId, created_by: owner.id }));
    const match = await publishedCapabilityMatchForModel(owner.client, modelId, '11.1');
    expect(match).toMatchObject({ sector: s.rows.catalogue.sector, capabilityMapVersion: 4, capabilityCode: '11.1' });
    expect(await publishedMapItemForCapability(owner.client, s.rows.catalogue.sector, '11.1')).toMatchObject({ capabilityCode: '11.1' });
    expect(await publishedCapabilityMatchForModel(owner.client, modelId, 'not-a-code')).toBeNull();
  });
  async function option(as = owner) {
    const decision = await createDecision(owner.client, { id: randomUUID(), orgId, modelId, title: 'Connection quotations', statement: 'Issue quotes in two days', ownerId: owner.id, createdBy: owner.id });
    const main = await getMainBranch(owner.client, modelId);
    if (!main?.head_commit_id) throw new Error('Missing main');
    const branch = await createChangeBranch(as.client, { id: randomUUID(), orgId, modelId, name: `Option ${randomUUID()}`, createdBy: as.id,
      intent: 'explore', mainHeadCommitId: main.head_commit_id });
    const mark: DecisionOptionMark = { decisionId: decision.id, branchId: branch.id, agent: 'designer', draftedAt: '2026-11-20T10:00:00Z',
      draftRunId: randomUUID(), suggestedTitle: 'Configure quotation handling', suggestedSummary: 'A candidate to investigate.', editedBy: null, editedAt: null };
    return mark;
  }
  const tables = ['product_catalogues', 'catalogue_entries', 'catalogue_entry_capabilities', 'catalogue_claims'] as const;

  it('hides drafts, exposes published content to every member role and other organisations, excludes anon', async () => {
    const s = await seed();
    const scope = [s.id, s.entryId, s.entryId, s.entryId];
    const cols = ['id', 'id', 'entry_id', 'entry_id'];
    for (const [i, table] of tables.entries()) {
      const r = await owner.client.from(table).select('*').eq(at(cols, i), at(scope, i));
      check(r); expect(r.data).toEqual([]);
      expect((await anon.from(table).select('*')).error).not.toBeNull();
    }
    check(await publish(s.id));
    for (const u of [owner, contributor, viewer, outsider]) {
      for (const [i, table] of tables.entries()) {
        const r = await u.client.from(table).select('*').eq(at(cols, i), at(scope, i));
        check(r); expect(r.data).toHaveLength(1);
      }
    }
  });

  it('refuses every organisation write to the four platform tables', async () => {
    const s = await seed();
    const values = [s.rows.catalogue, at(s.rows.entries), at(s.rows.capabilities), at(s.rows.claims)];
    for (const [i, table] of tables.entries()) {
      expect((await owner.client.from(table).insert({ ...at(values, i) })).error).not.toBeNull();
      expect((await owner.client.from(table).update(at(values, i)).eq(i > 1 ? 'entry_id' : 'id', i === 0 ? s.id : s.entryId)).error).not.toBeNull();
      expect((await owner.client.from(table).delete().eq(i > 1 ? 'entry_id' : 'id', i === 0 ? s.id : s.entryId)).error).not.toBeNull();
    }
  });

  it('validates review dates, HTTPS, no-price text, uniqueness and map identity in the database', async () => {
    const s = await seed(); const q = at(s.rows.claims);
    for (const update of [{ reviewed_by: '' }, { source_url: 'http://example.com/x' }, { reviewed_at: '2026-01-01' },
      { statement: 'Pricing is available' }, { source_url: 'https://example.com/pricing' }, { reviewed_by: 'USD' }]) {
      expect((await service.from('catalogue_claims').update(update).eq('id', q.id)).error).not.toBeNull();
    }
    expect((await service.from('catalogue_entries').insert({ ...at(s.rows.entries), id: randomUUID() })).error).not.toBeNull();
    check(await service.from('catalogue_entry_capabilities').update({ capability_name: 'Another capability' }).eq('entry_id', s.entryId));
    expect((await publish(s.id)).error?.message).toContain('pinned starter map');
    check(await service.from('catalogue_entry_capabilities').update({ capability_name: 'Connection Quotations' }).eq('entry_id', s.entryId));
    check(await publish(s.id));
  });

  it('requires a published starter map and complete, bounded evidence before publication', async () => {
    const s = await seed(undefined, undefined, false);
    expect((await publish(s.id)).error?.message).toContain('published starter map');
    const empty = await seed();
    check(await service.from('catalogue_claims').delete().eq('entry_id', empty.entryId));
    expect((await publish(empty.id)).error?.message).toContain('1-8 claims');
    check(await service.from('catalogue_entries').delete().eq('id', empty.entryId));
    expect((await publish(empty.id)).error?.message).toContain('needs an entry');
    const big = structuredClone(catalogueFixture);
    at(big.entries).claims = Array.from({ length: 8 }, (_, i) => ({ ...at(at(big.entries).claims), position: i + 1,
      sourceUrl: `https://example.com/${'x'.repeat(1700)}/${String(i)}` }));
    const oversized = await seed(big);
    expect((await publish(oversized.id)).error?.message).toContain('8000 bytes');
    expect((await service.from('product_catalogues').insert({ ...s.rows.catalogue, id: randomUUID(), version: 2, status: 'published', published_at: new Date().toISOString() })).error).not.toBeNull();
  });

  it('refuses publication behind an existing version and derives fallback after withdrawal', async () => {
    const first = await seed();
    const content = structuredClone(catalogueFixture); content.version = 2;
    const second = await seed(content, first.citation.sector, false);
    expect((await publish(first.id)).error?.message).toContain('exceed every other version');
    check(await service.from('product_catalogues').delete().eq('id', second.id));
    check(await publish(first.id));
    const latest = await seed(content, first.citation.sector, false); check(await publish(latest.id));
    const current = () => owner.client.from('product_catalogues').select('version').eq('sector', first.citation.sector)
      .eq('status', 'published').is('withdrawn_at', null).order('version', { ascending: false }).limit(1).single();
    const before = await current(); check(before); expect(before.data?.version).toBe(2);
    check(await service.from('product_catalogues').update({ withdrawn_at: '2026-11-21T10:00:00Z', withdrawn_reason: 'Incorrect evidence' }).eq('id', latest.id));
    const after = await current(); check(after); expect(after.data?.version).toBe(1);
  });

  it('makes published content immutable, refuses reparenting, and cascades only drafts', async () => {
    const s = await seed(); const other = await seed();
    expect((await service.from('catalogue_entries').update({ catalogue_id: other.id }).eq('id', s.entryId)).error).not.toBeNull();
    expect((await service.from('catalogue_claims').update({ entry_id: other.entryId }).eq('entry_id', s.entryId)).error).not.toBeNull();
    check(await publish(s.id));
    expect((await service.from('product_catalogues').update({ title: 'Changed' }).eq('id', s.id)).error).not.toBeNull();
    expect((await service.from('product_catalogues').delete().eq('id', s.id)).error).not.toBeNull();
    expect((await service.from('catalogue_entries').update({ summary: 'Changed' }).eq('id', s.entryId)).error).not.toBeNull();
    expect((await service.from('catalogue_claims').delete().eq('entry_id', s.entryId)).error).not.toBeNull();
    expect((await service.from('catalogue_entry_capabilities').delete().eq('entry_id', s.entryId)).error).not.toBeNull();
    check(await service.from('product_catalogues').delete().eq('id', other.id));
    for (const table of ['catalogue_entries', 'catalogue_claims', 'catalogue_entry_capabilities']) {
      const r = await service.from(table).select('*').eq(table === 'catalogue_entries' ? 'id' : 'entry_id', other.entryId);
      check(r); expect(r.data).toEqual([]);
    }
  });

  it('saves a contributor option, its edit stamp and a database-built snapshot together; retries preserve later edits', async () => {
    const s = await seed(); check(await publish(s.id));
    const m = await option(contributor);
    m.editedBy = contributor.id; m.editedAt = '2026-11-20T10:01:00Z';
    await addOptionWithCatalogueSources(contributor.client, m, [s.citation]);
    const sources = await listCatalogueSources(contributor.client, m.decisionId);
    // Synthetic sector is deliberately outside the content taxonomy; compare the exact DB fields.
    const expected = catalogueSnapshotFromRows({ ...s.rows, catalogue: { ...s.rows.catalogue, sector: 'electricity_network' } }, s.entryId);
    expect(sources[0]?.snapshot).toEqual({ ...expected, sector: s.citation.sector });
    expect(sources[0]?.cited_by).toBe(contributor.id);
    const mapped = await listOptionSources(viewer.client, m.decisionId);
    expect(mapped[0]).toMatchObject({ kind: 'catalogue', branchId: m.branchId, product: 'Quotation Tool', standing: 'current' });
    const first = mapped[0];
    if (first?.kind !== 'catalogue') throw new Error('Expected a catalogue source');
    expect(first.claims).toHaveLength(1);
    await markOptionEdited(owner.client, { decisionId: m.decisionId, branchId: m.branchId, editedBy: owner.id, editedAt: '2026-11-20T10:02:00Z' });
    await addOptionWithCatalogueSources(contributor.client, m, [s.citation]);
    expect(await listCatalogueSources(viewer.client, m.decisionId)).toHaveLength(1);
    const marks = await owner.client.from('decision_option_marks').select('*').eq('decision_id', m.decisionId);
    check(marks); expect(marks.data?.[0]?.edited_by).toBe(owner.id);
    await expect(addOptionWithCatalogueSources(contributor.client, { ...m, suggestedTitle: 'Different draft' }, [s.citation])).rejects.toThrow('different provenance');
    await expect(addOptionWithCatalogueSources(contributor.client, m, [{ ...s.citation, entryCode: 'different-entry' }])).rejects.toThrow('different provenance');
  });

  it('saves web sources append-only and only for decision members', async () => {
    const m = await option();
    await createDecisionLink(owner.client, { decisionId: m.decisionId, linkedType: 'branch', linkedId: m.branchId, createdBy: owner.id });
    const base = { decision_id: m.decisionId, branch_id: m.branchId, url: 'https://example.com/evidence', title: 'Evidence', publisher: 'Example', excerpt: 'Says so.', retrieved_at: '2026-11-21T10:00:00Z', cited_by: contributor.id };
    check(await contributor.client.from('option_web_sources').insert(base));
    expect(await listOptionWebSources(viewer.client, m.decisionId)).toHaveLength(1);
    expect(await listOptionWebSources(outsider.client, m.decisionId)).toEqual([]);
    expect((await anon.from('option_web_sources').select('*')).error).not.toBeNull();
    expect((await viewer.client.from('option_web_sources').insert({ ...base, url: 'https://example.com/viewer', cited_by: viewer.id })).error).not.toBeNull();
    expect((await contributor.client.from('option_web_sources').insert({ ...base, url: 'https://example.com/spoof', cited_by: owner.id })).error).not.toBeNull();
    expect((await contributor.client.from('option_web_sources').insert({ ...base, url: 'http://example.com/insecure' })).error).not.toBeNull();
    expect((await contributor.client.from('option_web_sources').insert(base)).error).not.toBeNull();
    expect((await owner.client.from('option_web_sources').update({ title: 'Changed' }).eq('decision_id', m.decisionId)).error).not.toBeNull();
    expect((await owner.client.from('option_web_sources').delete().eq('decision_id', m.decisionId)).error).not.toBeNull();
    expect((await service.from('option_web_sources').delete().eq('decision_id', m.decisionId)).error).not.toBeNull();
  });

  it('saves the caller\'s own check with the page and stamps the check time on the server', async () => {
    const m = await option();
    await createDecisionLink(owner.client, { decisionId: m.decisionId, linkedType: 'branch', linkedId: m.branchId, createdBy: owner.id });
    const base = {
      decision_id: m.decisionId,
      branch_id: m.branchId,
      url: 'https://example.com/checked',
      title: 'Checked evidence',
      publisher: 'Example',
      excerpt: 'It records complaints.',
      retrieved_at: '2026-11-21T10:00:00Z',
      cited_by: contributor.id,
      assertion: 'It records complaints.',
      checked_by: contributor.id,
      checked_at: '2000-01-01T00:00:00Z',
    };
    check(await contributor.client.from('option_web_sources').insert(base));
    const saved = at(await listOptionWebSources(viewer.client, m.decisionId));
    expect(saved).toMatchObject({ assertion: 'It records complaints.', checkedBy: contributor.id });
    expect(saved.checkedAt).not.toBe('2000-01-01T00:00:00Z');
    // A check may be empty, but it can never be attributed to someone else.
    expect((await contributor.client.from('option_web_sources').insert({ ...base, url: 'https://example.com/spoofed-check', checked_by: owner.id })).error).not.toBeNull();
    // Assertion and check must arrive together.
    expect((await contributor.client.from('option_web_sources').insert({ ...base, url: 'https://example.com/half-check', checked_by: null, checked_at: null })).error).not.toBeNull();
  });

  it('records web research requests append-only for decision members', async () => {
    const m = await option();
    await createDecisionLink(owner.client, { decisionId: m.decisionId, linkedType: 'branch', linkedId: m.branchId, createdBy: owner.id });
    const row = {
      id: randomUUID(),
      org_id: orgId,
      decision_id: m.decisionId,
      branch_id: m.branchId,
      requested_by: contributor.id,
      query: 'Oracle utilities customer service',
      status: 'ok',
      result_count: 1,
      urls: ['https://example.com/evidence'],
      error: null,
    };
    check(await contributor.client.from('web_research_requests').insert(row));
    const read = await viewer.client.from('web_research_requests').select('*').eq('decision_id', m.decisionId);
    check(read);
    expect(read.data).toHaveLength(1);
    const outside = await outsider.client.from('web_research_requests').select('*').eq('decision_id', m.decisionId);
    check(outside);
    expect(outside.data).toEqual([]);
    expect((await viewer.client.from('web_research_requests').insert({ ...row, id: randomUUID(), requested_by: viewer.id })).error).not.toBeNull();
    expect((await contributor.client.from('web_research_requests').update({ status: 'error' }).eq('id', row.id)).error).not.toBeNull();
    expect((await contributor.client.from('web_research_requests').delete().eq('id', row.id)).error).not.toBeNull();
    expect((await service.from('web_research_requests').delete().eq('id', row.id)).error).not.toBeNull();
  });

  it('rolls back link and mark on a bad source, then safely retries with the same branch ID', async () => {
    const s = await seed(); check(await publish(s.id));
    const m = await option();
    await expect(addOptionWithCatalogueSources(owner.client, m, [s.citation, { ...s.citation, entryCode: 'missing-entry' }])).rejects.toThrow();
    for (const table of ['decision_links', 'decision_option_marks', 'option_catalogue_sources']) {
      const r = await owner.client.from(table).select('*').eq('decision_id', m.decisionId); check(r); expect(r.data).toEqual([]);
    }
    await Promise.all([addOptionWithCatalogueSources(owner.client, m, [s.citation]), addOptionWithCatalogueSources(owner.client, m, [s.citation])]);
    expect(await listCatalogueSources(owner.client, m.decisionId)).toHaveLength(1);
  });

  it('overwrites forged snapshots and timestamps, and refuses update/delete or spoofed attribution', async () => {
    const s = await seed(); check(await publish(s.id)); const m = await option();
    await createDecisionLink(owner.client, { decisionId: m.decisionId, linkedType: 'branch', linkedId: m.branchId, createdBy: owner.id });
    const source = { decision_id: m.decisionId, branch_id: m.branchId, catalogue_sector: s.citation.sector, catalogue_version: s.citation.version,
      entry_code: s.citation.entryCode, snapshot: { product: 'Forged' }, cited_by: owner.id, cited_at: '2000-01-01T00:00:00Z' };
    expect((await contributor.client.from('option_catalogue_sources').insert(source)).error).not.toBeNull();
    check(await owner.client.from('option_catalogue_sources').insert(source));
    const rows = await listCatalogueSources(owner.client, m.decisionId);
    expect(rows[0]?.snapshot.product).toBe('Quotation Tool'); expect(rows[0]?.cited_at).not.toContain('2000-01-01');
    expect((await owner.client.from('option_catalogue_sources').update({ snapshot: {} }).eq('decision_id', m.decisionId)).error).not.toBeNull();
    expect((await owner.client.from('option_catalogue_sources').delete().eq('decision_id', m.decisionId)).error).not.toBeNull();
    expect((await service.from('option_catalogue_sources').update({ snapshot: {} }).eq('decision_id', m.decisionId)).error).not.toBeNull();
  });

  it('rejects viewers, other organisations, signed-out callers, missing branches and closed decisions', async () => {
    const s = await seed(); check(await publish(s.id)); const m = await option();
    for (const client of [viewer.client, outsider.client, anon]) await expect(addOptionWithCatalogueSources(client, m, [s.citation])).rejects.toThrow();
    await expect(addOptionWithCatalogueSources(owner.client, { ...m, branchId: randomUUID() }, [s.citation])).rejects.toThrow();
    await expect(addOptionWithCatalogueSources(owner.client, { ...m, editedBy: outsider.id, editedAt: '2026-11-20T10:02:00Z' }, [s.citation])).rejects.toThrow();
    const otherModelId = randomUUID();
    await createModel(owner.client, { id: otherModelId, orgId, name: 'Other model', slug: `cat-${otherModelId}`, createdBy: owner.id });
    const otherMain = await getMainBranch(owner.client, otherModelId);
    if (!otherMain?.head_commit_id) throw new Error('Missing other main');
    const wrongBranch = await createChangeBranch(owner.client, { id: randomUUID(), orgId, modelId: otherModelId, name: `Other ${randomUUID()}`,
      intent: 'explore', createdBy: owner.id, mainHeadCommitId: otherMain.head_commit_id });
    await expect(addOptionWithCatalogueSources(owner.client, { ...m, branchId: wrongBranch.id }, [s.citation])).rejects.toThrow();
    await addOptionWithCatalogueSources(owner.client, m, [s.citation]);
    expect(await listCatalogueSources(outsider.client, m.decisionId)).toEqual([]);
    expect((await anon.from('option_catalogue_sources').select('*')).error).not.toBeNull();
    check(await service.from('decisions').update({ status: 'rejected' }).eq('id', m.decisionId));
    await expect(addOptionWithCatalogueSources(owner.client, m, [s.citation])).rejects.toThrow();
  });

  // Item 2 of the 25 Nov review: a Designer suggestion is saved as a candidate, with no change branch.
  function candidateInput(decisionId: string) {
    return { decisionId, id: randomUUID(), title: 'Buy a quoting product', summary: 'Replace quoting with a product.', toWeigh: 'Time to switch.',
      approach: 'buy' as const, draftedAt: '2026-11-25T10:00:00Z', editedBy: null, editedAt: null, catalogueRefs: [] as { sector: string; version: number; entryCode: string }[] };
  }

  it('saves a Designer suggestion as a candidate with its mark and citations, makes no change, and keeps both after Work on this option', async () => {
    const s = await seed(); check(await publish(s.id));
    const { decisionId } = await option(contributor);
    const input = { ...candidateInput(decisionId), editedBy: contributor.id, editedAt: '2026-11-25T10:01:00Z', catalogueRefs: [s.citation] };
    const saved = await addDesignerCandidate(contributor.client, input);
    expect(saved).toMatchObject({ id: input.id, branch_id: null, source: 'designer', agent: 'designer', approach: 'buy', to_weigh: 'Time to switch.', edited_by: contributor.id });
    const sources = await listOptionSources(viewer.client, decisionId);
    expect(sources).toEqual([expect.objectContaining({ kind: 'catalogue', optionId: input.id, branchId: null, product: 'Quotation Tool' })]);
    const links = await owner.client.from('decision_links').select('linked_id').eq('decision_id', decisionId).eq('linked_type', 'branch');
    check(links); expect(links.data).toEqual([]);

    // A retry or double click completes the same option, never a second one, and keeps a later edit.
    check(await owner.client.from('decision_options').update({ title: 'Move quoting to QuoteCo', updated_by: owner.id }).eq('id', input.id));
    await Promise.all([addDesignerCandidate(contributor.client, input), addDesignerCandidate(contributor.client, input)]);
    expect((await listDecisionOptions(owner.client, decisionId)).filter((o) => o.id === input.id)).toEqual([expect.objectContaining({ title: 'Move quoting to QuoteCo' })]);
    await expect(addDesignerCandidate(contributor.client, { ...input, catalogueRefs: [] })).rejects.toThrow('different provenance');

    const branch = await workOnDecisionOption(contributor.client, input.id);
    expect(await getDecisionOptionForBranch(owner.client, decisionId, branch.id)).toMatchObject({ id: input.id, source: 'designer', edited_by: contributor.id });
    expect((await listOptionSources(owner.client, decisionId)).map((x) => x.optionId)).toEqual([input.id]);
  });

  it('refuses a Designer candidate from a viewer, another organisation, a signed-out caller, a spoofed editor, the baseline type or a closed decision', async () => {
    const s = await seed(); check(await publish(s.id));
    const { decisionId } = await option();
    for (const client of [viewer.client, outsider.client, anon]) await expect(addDesignerCandidate(client, { ...candidateInput(decisionId), catalogueRefs: [s.citation] })).rejects.toThrow();
    await expect(addDesignerCandidate(owner.client, { ...candidateInput(decisionId), editedBy: outsider.id, editedAt: '2026-11-25T10:02:00Z' })).rejects.toThrow();
    await expect(addDesignerCandidate(owner.client, { ...candidateInput(decisionId), approach: 'no_change' })).rejects.toThrow();
    // A bad citation rolls the candidate back too.
    const bad = candidateInput(decisionId);
    await expect(addDesignerCandidate(owner.client, { ...bad, catalogueRefs: [{ ...s.citation, entryCode: 'missing-entry' }] })).rejects.toThrow();
    expect((await listDecisionOptions(owner.client, decisionId)).some((o) => o.id === bad.id)).toBe(false);
    expect(await listDecisionOptions(outsider.client, decisionId)).toEqual([]);
    check(await service.from('decisions').update({ status: 'rejected' }).eq('id', decisionId));
    await expect(addDesignerCandidate(owner.client, candidateInput(decisionId))).rejects.toThrow();
  });

  it('makes a listed product a Buy candidate with the product saved as its source; refuses viewers, other organisations and closed decisions', async () => {
    const s = await seed(); check(await publish(s.id));
    const { decisionId } = await option();
    const optionId = randomUUID();
    const saved = await createDecisionOption(contributor.client, { id: optionId, decisionId, title: 'Use Quotation Tool', summary: 'A quoting product.', approach: 'buy', createdBy: contributor.id });
    expect(saved).toMatchObject({ id: optionId, branch_id: null, source: 'manual', approach: 'buy' });
    const source = { decisionId, optionId, sector: s.citation.sector, version: s.citation.version, entryCode: s.citation.entryCode };
    await insertOptionCatalogueSource(contributor.client, { ...source, citedBy: contributor.id });
    expect(await listOptionSources(viewer.client, decisionId)).toEqual([expect.objectContaining({ kind: 'catalogue', optionId, branchId: null, product: 'Quotation Tool' })]);
    await expect(insertOptionCatalogueSource(contributor.client, { ...source, citedBy: contributor.id })).rejects.toThrow('already saved');

    const other = randomUUID();
    await createDecisionOption(owner.client, { id: other, decisionId, title: 'Buy another tool', approach: 'buy', createdBy: owner.id });
    const forOther = { ...source, optionId: other };
    await expect(insertOptionCatalogueSource(viewer.client, { ...forOther, citedBy: viewer.id })).rejects.toThrow();
    await expect(insertOptionCatalogueSource(outsider.client, { ...forOther, citedBy: outsider.id })).rejects.toThrow();
    await expect(insertOptionCatalogueSource(owner.client, { ...forOther, citedBy: contributor.id })).rejects.toThrow();
    await expect(createDecisionOption(outsider.client, { decisionId, title: 'Buy from outside', approach: 'buy', createdBy: outsider.id })).rejects.toThrow();
    check(await service.from('decisions').update({ status: 'rejected' }).eq('id', decisionId));
    await expect(insertOptionCatalogueSource(owner.client, { ...forOther, citedBy: owner.id })).rejects.toThrow();
    expect((await listOptionSources(owner.client, decisionId)).map((x) => x.optionId)).toEqual([optionId]);
  });

  it('cites a product published on its own: saved with a snapshot, replaced by a newer revision, withdrawn, and never cited once replaced', async () => {
    const suffix = randomUUID().slice(0, 8);
    const code = `test-cite-${suffix}`;
    const productId = randomUUID();
    check(await service.from('catalogue_products').insert({ id: productId, code, product: `Cited product ${suffix}`, vendor: 'Test vendor', summary: 'A product to cite.', created_by: owner.id, updated_by: owner.id }));
    const revision = async (n: number, summary: string) => {
      const id = randomUUID();
      check(await service.from('catalogue_product_revisions').insert({ id, product_id: productId, revision: n, product_edit_revision: n, code, product: `Cited product ${suffix}`, vendor: 'Test vendor', summary, published_by: owner.id, published_by_name: 'Priya' }));
      check(await service.from('catalogue_product_revision_claims').insert({ revision_id: id, position: 1, kind: 'functional', statement: 'The vendor describes this as a test product.', source_url: 'https://example.test/cite', source_date: '2026-11-01', origin: 'person', drafted_at: '2026-11-02T09:00:00Z', reviewed_by: 'Priya', reviewed_by_user: owner.id, reviewed_at: '2026-11-03' }));
      return id;
    };
    await revision(1, 'First summary.');
    const { decisionId } = await option();
    const optionId = randomUUID();
    await createDecisionOption(contributor.client, { id: optionId, decisionId, title: `Use Cited product ${suffix}`, summary: 'A product.', approach: 'buy', createdBy: contributor.id });
    await insertOptionCatalogueSource(contributor.client, { decisionId, optionId, sector: 'product', version: 1, entryCode: code, citedBy: contributor.id });
    const saved = await listOptionSources(viewer.client, decisionId);
    expect(saved).toEqual([expect.objectContaining({ kind: 'catalogue', sector: 'product', version: 1, entryCode: code, summary: 'First summary.', standing: 'current' })]);
    const first = saved[0];
    expect(first?.kind === 'catalogue' ? first.claims : []).toHaveLength(1);

    // A newer revision replaces it; the saved citation keeps its own words and says so.
    await revision(2, 'Second summary.');
    const replaced = await listOptionSources(viewer.client, decisionId);
    expect(replaced).toEqual([expect.objectContaining({ version: 1, summary: 'First summary.', standing: 'replaced' })]);
    // The cited revision stays readable to someone who can see the decision, but not to another organisation.
    expect(((await viewer.client.from('catalogue_product_revisions').select('revision').eq('code', code).eq('revision', 1)).data ?? [])).toHaveLength(1);
    expect(((await outsider.client.from('catalogue_product_revisions').select('revision').eq('code', code).eq('revision', 1)).data ?? [])).toHaveLength(0);
    // A replaced revision cannot be newly cited; the current one can.
    const second = randomUUID();
    await createDecisionOption(owner.client, { id: second, decisionId, title: `Buy Cited product ${suffix}`, approach: 'buy', createdBy: owner.id });
    await expect(insertOptionCatalogueSource(owner.client, { decisionId, optionId: second, sector: 'product', version: 1, entryCode: code, citedBy: owner.id })).rejects.toThrow();
    await insertOptionCatalogueSource(owner.client, { decisionId, optionId: second, sector: 'product', version: 2, entryCode: code, citedBy: owner.id });

    // Withdrawing the newest revision leaves both citations saved, and both say the product is no longer published.
    check(await service.from('catalogue_product_revisions').update({ withdrawn_at: '2026-11-27T10:00:00Z', withdrawn_reason: 'The vendor sold the product.' }).eq('product_id', productId).eq('revision', 2));
    const standings = (await listOptionSources(viewer.client, decisionId)).map((x) => (x.kind === 'catalogue' ? `${String(x.version)}:${x.standing}` : '')).sort();
    expect(standings).toEqual(['1:withdrawn', '2:withdrawn']);
    // Viewers and other organisations still cannot cite anything.
    await expect(insertOptionCatalogueSource(viewer.client, { decisionId, optionId: second, sector: 'product', version: 2, entryCode: code, citedBy: viewer.id })).rejects.toThrow();
    await expect(insertOptionCatalogueSource(outsider.client, { decisionId, optionId: second, sector: 'product', version: 2, entryCode: code, citedBy: outsider.id })).rejects.toThrow();
  });

  it('keeps snapshots unchanged across replacement/withdrawal and allows withdrawal only once', async () => {
    const s = await seed(); check(await publish(s.id)); const m = await option();
    await addOptionWithCatalogueSources(owner.client, m, [s.citation]);
    const before = await listCatalogueSources(owner.client, m.decisionId);
    const content = structuredClone(catalogueFixture); content.version = 2; at(content.entries).summary = 'Revised summary';
    const replacement = await seed(content, s.citation.sector, false); check(await publish(replacement.id));
    expect(await listCatalogueSources(owner.client, m.decisionId)).toEqual(before);
    check(await service.from('product_catalogues').update({ withdrawn_at: '2026-11-21T10:00:00Z', withdrawn_reason: 'The evidence was incorrect' }).eq('id', s.id));
    expect((await service.from('product_catalogues').update({ withdrawn_reason: 'Another reason' }).eq('id', s.id)).error).not.toBeNull();
    const old = await outsider.client.from('product_catalogues').select('*').eq('id', s.id); check(old); expect(old.data).toHaveLength(1);
    expect(await listCatalogueSources(owner.client, m.decisionId)).toEqual(before);
    const draft = await seed();
    expect((await service.from('product_catalogues').update({ withdrawn_at: '2026-11-21T10:00:00Z', withdrawn_reason: 'Wrong' }).eq('id', draft.id)).error).not.toBeNull();
  });

  it('serialises a child edit against publication, in both orders, using two DB sessions', async () => {
    const s = await seed();
    const editor = sqlSession();
    try {
      await editor.barrier(`begin; update catalogue_entries set summary = 'Edited before publication' where id = '${s.entryId}';`);
      const publisher = sqlSession();
      publisher.finish(`set lock_timeout = '500ms'; update product_catalogues set status = 'published', published_at = now() where id = '${s.id}';`);
      expect((await publisher.done).errors).toContain('lock timeout');
    } finally { editor.finish('commit;'); await editor.done; }
    const publisher = sqlSession();
    try {
      await publisher.barrier(`begin; update product_catalogues set status = 'published', published_at = now() where id = '${s.id}';`);
      const lateEditor = sqlSession();
      lateEditor.finish(`set lock_timeout = '500ms'; update catalogue_claims set statement = 'Concurrent edit' where entry_id = '${s.entryId}';`);
      expect((await lateEditor.done).errors).toContain('lock timeout');
    } finally { publisher.finish('commit;'); await publisher.done; }
    expect((await service.from('catalogue_claims').update({ statement: 'Edit after publication' }).eq('entry_id', s.entryId)).error).not.toBeNull();
    const entry = await owner.client.from('catalogue_entries').select('summary').eq('id', s.entryId).single(); check(entry);
    expect(entry.data?.summary).toBe('Edited before publication');
  });

  it('evaluates the price pattern consistently in PostgreSQL and JavaScript', async () => {
    const samples = ['USD', '£10', 'per user', 'free of charge', 'EUR20', '20USD', 'Subscription service', 'Costello Systems', 'pricing', 'Quoted functionality'];
    const session = sqlSession();
    session.finish(samples.map((v) => `select ${quote(v)} ~* ${quote(CATALOGUE_NO_PRICE_PATTERN)};`).join('\n'));
    const result = await session.done; expect(result.code, result.errors).toBe(0);
    expect(result.output.trim().split('\n')).toEqual(samples.map((v) => containsCataloguePrice(v) ? 't' : 'f'));
  });

  it('keeps trigger-only functions and the private snapshot helper out of the API', async () => {
    for (const name of ['guard_product_catalogue_state', 'guard_catalogue_child_immutable', 'build_option_catalogue_snapshot']) {
      expect((await owner.client.schema('atlas').rpc(name)).error).not.toBeNull();
      expect((await anon.schema('atlas').rpc(name)).error).not.toBeNull();
    }
    expect((await owner.client.schema('atlas_private').rpc('catalogue_entry_snapshot', { p_entry: randomUUID() })).error).not.toBeNull();
  });
});
