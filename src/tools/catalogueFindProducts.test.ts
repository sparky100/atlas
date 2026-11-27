import { describe, expect, it } from 'vitest';
import type { PageResponse } from './catalogueClaimCheck';
import { parseFindAnswer, productCode, splitByLibrary, verifyCandidates, type Candidate } from './catalogueFindProducts';

const PAGE = 'Acme Meter Hub collects and validates half-hourly smart meter reads from every supplier. It runs as a hosted service.';

function deps(pages: Record<string, string>) {
  return {
    resolve: () => Promise.resolve(['93.184.216.34']),
    getPage: (url: string): Promise<PageResponse> => {
      const body = pages[url];
      return Promise.resolve({
        status: body === undefined ? 404 : 200, location: null, contentType: 'text/html',
        readText: () => Promise.resolve(`<html><body><p>${body ?? ''}</p></body></html>`), discard: () => undefined,
      });
    },
  };
}

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  product: 'Meter Hub', vendor: 'Acme', summary: 'Smart meter data hub.', howItSupports: 'Validates meter reads.',
  claims: [{ kind: 'functional', sourceUrl: 'https://acme.example/hub', sentence: 'Acme Meter Hub collects and validates half-hourly smart meter reads from every supplier.' }],
  ...over,
});

describe('parseFindAnswer', () => {
  it('reads products and skips bad items', () => {
    const raw = `Here: ${JSON.stringify({ products: [candidate(), { product: 'No claims' }] })}`;
    expect(parseFindAnswer(raw)?.map((c) => c.product)).toEqual(['Meter Hub']);
  });
  it('returns null when the answer is not the object asked for', () => {
    expect(parseFindAnswer('no json here')).toBeNull();
    expect(parseFindAnswer('{"items":[]}')).toBeNull();
  });
  it('treats an unknown claim kind as functional and caps products at 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => candidate({ product: `P${String(i)}`, claims: [{ kind: 'weird' as never, sourceUrl: 'https://a.example', sentence: 'x' }] }));
    const parsed = parseFindAnswer(JSON.stringify({ products: many }));
    expect(parsed).toHaveLength(8);
    expect(parsed?.[0]?.claims[0]?.kind).toBe('functional');
  });
});

describe('verifyCandidates', () => {
  it('keeps a claim whose sentence is on the page', async () => {
    const result = await verifyCandidates([candidate()], deps({ 'https://acme.example/hub': PAGE }));
    expect(result.found).toHaveLength(1);
    expect(result.found[0]?.claims).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });
  it('drops a product when no sentence is on the page', async () => {
    const made = candidate({ claims: [{ kind: 'functional', sourceUrl: 'https://acme.example/hub', sentence: 'Acme Meter Hub also predicts the weather for every customer.' }] });
    const result = await verifyCandidates([made], deps({ 'https://acme.example/hub': PAGE }));
    expect(result.found).toHaveLength(0);
    expect(result.dropped[0]?.reason).toContain('No sentence');
  });
  it('drops a claim when the page cannot be read, and a claim that states a price', async () => {
    const made = candidate({ claims: [
      { kind: 'functional', sourceUrl: 'https://gone.example/x', sentence: 'Acme Meter Hub collects and validates half-hourly smart meter reads from every supplier.' },
      { kind: 'licensing_model', sourceUrl: 'https://acme.example/hub', sentence: 'It costs £500 per month for every site.' },
    ] });
    const result = await verifyCandidates([made], deps({ 'https://acme.example/hub': `${PAGE} It costs £500 per month for every site.` }));
    expect(result.found).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
  });
});

describe('verifyCandidates, platform', () => {
  const PLATFORM_PAGE = `${PAGE} Meter Hub is a module of the Acme Grid platform.`;
  it('keeps the platform only when a cited page names it', async () => {
    const sourceUrl = 'https://acme.example/hub';
    const named = await verifyCandidates([candidate({ platform: 'Acme Grid' })], deps({ [sourceUrl]: PLATFORM_PAGE }));
    expect(named.found[0]?.platform).toBe('Acme Grid');
    const guessed = await verifyCandidates([candidate({ platform: 'Acme Grid' })], deps({ [sourceUrl]: PAGE }));
    expect(guessed.found[0]?.platform).toBeNull();
  });
  it('drops a platform that is the product itself, and keeps none when there is none', async () => {
    const same = await verifyCandidates([candidate({ platform: 'Acme Meter Hub' })], deps({ 'https://acme.example/hub': PAGE }));
    expect(same.found[0]?.platform).toBeNull();
    const none = await verifyCandidates([candidate()], deps({ 'https://acme.example/hub': PAGE }));
    expect(none.found[0]?.platform).toBeNull();
  });
  it('reads the platform from the model answer and ignores a bad one', () => {
    const raw = (platform: unknown) => JSON.stringify({ products: [{ ...candidate(), platform }] });
    expect(parseFindAnswer(raw('Acme Grid'))?.[0]?.platform).toBe('Acme Grid');
    expect(parseFindAnswer(raw(null))?.[0]?.platform).toBeNull();
    expect(parseFindAnswer(raw(42))?.[0]?.platform).toBeNull();
  });
});

describe('splitByLibrary', () => {
  it('matches vendor and name regardless of case and spacing, and does not repeat a product', () => {
    const library = [{ id: 'p1', vendor: 'ACME', product: 'Meter  Hub' }];
    const items = [{ vendor: 'Acme', product: 'meter hub' }, { vendor: 'Beta', product: 'Reads' }, { vendor: 'beta', product: 'reads' }];
    const split = splitByLibrary(items, library);
    expect(split.existing.map((i) => i.productId)).toEqual(['p1']);
    expect(split.added).toHaveLength(1);
  });
});

describe('productCode', () => {
  it('makes a lowercase code and keeps it unique', () => {
    expect(productCode('Acme Ltd', 'Meter Hub®', new Set())).toBe('acme-ltd-meter-hub');
    expect(productCode('Acme Ltd', 'Meter Hub®', new Set(['acme-ltd-meter-hub']))).toBe('acme-ltd-meter-hub-2');
    expect(productCode('', '', new Set())).toBe('product');
  });
});
