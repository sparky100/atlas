import { describe, expect, it } from 'vitest';
import type { Client } from '../../src/db/client';
import { ATLAS_MODEL_TOOLS, DISABLED_MESSAGE, resolveModel } from './atlasTools';
import type { VisibleModel } from './models';

const M = (id: string, name: string, archived = false): VisibleModel => ({ modelId: id, name, slug: name.toLowerCase(), organisation: 'Council', organisationSlug: 'council', archived });

describe('resolveModel', () => {
  it('picks the only live model when none is named', () => {
    expect(resolveModel([M('a', 'Alpha'), M('b', 'Old', true)], undefined)).toMatchObject({ ok: true, model: { modelId: 'a' } });
  });
  it('asks when several are live and none is named', () => {
    const r = resolveModel([M('a', 'Alpha'), M('b', 'Beta')], undefined);
    expect(r.ok).toBe(false);
  });
  it('matches by id, slug or name, ignoring case', () => {
    const models = [M('a', 'Alpha'), M('b', 'Beta')];
    for (const w of ['b', 'BETA', 'beta']) expect(resolveModel(models, w)).toMatchObject({ ok: true, model: { modelId: 'b' } });
  });
  it('rejects an unknown or ambiguous name', () => {
    expect(resolveModel([M('a', 'Alpha')], 'zzz').ok).toBe(false);
    expect(resolveModel([M('a', 'Same'), M('b', 'Same')], 'same').ok).toBe(false);
  });
});

function fake(enabled: boolean): Client {
  const rows: Record<string, unknown> = {
    models: [{ id: 'm1', org_id: 'o1', name: 'Alpha', slug: 'alpha', archived_at: null }],
    organisations: [{ id: 'o1', name: 'Council', slug: 'council', ai_assistant_enabled: enabled }],
  };
  return {
    from: (table: string) => {
      const list = rows[table] as unknown[];
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => ({ range: () => Promise.resolve({ data: list, error: null, count: list.length }) }),
        maybeSingle: () => Promise.resolve({ data: list[0] ?? null, error: null }),
      };
      return builder;
    },
  } as unknown as Client;
}

describe('model tools over MCP', () => {
  const search = ATLAS_MODEL_TOOLS.find((t) => t.name === 'atlas_search_elements');
  it('refuse while the organisation has not turned on AI access', async () => {
    const out = await search?.run(fake(false), { query: 'CRM' });
    expect(out).toEqual({ text: DISABLED_MESSAGE, isError: true });
  });
  it('rejects a change id that is not an id, before reading anything', async () => {
    const out = await search?.run(fake(true), { query: 'CRM', change: 'nope' });
    expect(out?.isError).toBe(true);
    expect(out?.text).toMatch(/changeId/);
  });
});
