import { describe, expect, it } from 'vitest';
import { parsePrincipleSetPayload } from '../contracts/principleSet';
import { buildPrincipleSetPayload, planPrincipleSetCopy } from './principleSet';

const mk = (n: number) => () => `id-${String(++n)}`;
const p = (title: string, status: 'active' | 'retired' = 'active') => ({ title, statement: `${title} rule`, why: '', status });
const source = { slug: 'core', name: 'Core principles', version: 2 };

describe('buildPrincipleSetPayload', () => {
  it('keeps only active principles, trimmed, A to Z', () => {
    const payload = buildPrincipleSetPayload([p('  Zed '), p('Alpha'), p('Gone', 'retired')]);
    expect(payload.principles.map((x) => x.title)).toEqual(['Alpha', 'Zed']);
  });

  it('round-trips through the stored shape unchanged', () => {
    const payload = buildPrincipleSetPayload([p('One'), p('Two')]);
    expect(parsePrincipleSetPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });
});

describe('parsePrincipleSetPayload', () => {
  it('refuses an empty set and a missing field', () => {
    expect(() => parsePrincipleSetPayload({ principles: [] })).toThrow();
    expect(() => parsePrincipleSetPayload({ principles: [{ title: 'x', statement: 'y' }] })).toThrow();
    expect(() => parsePrincipleSetPayload(null)).toThrow();
  });
});

describe('planPrincipleSetCopy', () => {
  const payload = buildPrincipleSetPayload([p('A'), p('B'), p('C')]);

  it('adds only the principles picked, with where they came from', () => {
    const plan = planPrincipleSetCopy(payload, source, [0, 2], [], mk(0));
    expect(plan.rows.map((r) => r.title)).toEqual(['A', 'C']);
    expect(plan.rows[0]).toMatchObject({ id: 'id-1', from_set_slug: 'core', from_set_name: 'Core principles', from_set_version: 2 });
    expect(plan.alreadyThere).toEqual([]);
  });

  it('adds nothing when nothing is picked, and ignores positions outside the set', () => {
    expect(planPrincipleSetCopy(payload, source, [], [], mk(0)).rows).toEqual([]);
    expect(planPrincipleSetCopy(payload, source, [9, -1], [], mk(0)).rows).toEqual([]);
  });

  it('skips a title the model already has, ignoring case, so adding twice changes nothing', () => {
    const plan = planPrincipleSetCopy(payload, source, [0, 1], [' a '], mk(0));
    expect(plan.rows.map((r) => r.title)).toEqual(['B']);
    expect(plan.alreadyThere).toEqual(['A']);
  });

  it('is reproducible for the same inputs and minter', () => {
    expect(planPrincipleSetCopy(payload, source, [0, 1, 2], [], mk(0))).toEqual(planPrincipleSetCopy(payload, source, [0, 1, 2], [], mk(0)));
  });
});
