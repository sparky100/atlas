import { describe, expect, it } from 'vitest';
import { DESIGNER_MAX_FINDING_CHARS } from '../../tools/designPrompt';
import { prefillFromSystemWithoutCapability } from './decisionPrefill';
import { canOfferDesigner, designerCostLine, designerInputFromPrefill, designerUnavailableReason } from './designerRequest';

const ID = '00000000-0000-4000-8000-000000000001';

describe('designerInputFromPrefill', () => {
  it('asks about the first thing the finding names, in the finding\'s own words', () => {
    const input = designerInputFromPrefill(prefillFromSystemWithoutCapability({ id: ID, name: 'Quote Tool' }));
    expect(input?.elementId).toBe(ID);
    expect(input?.finding).toContain('no capability link recorded');
  });

  it('cuts a long finding to the limit the function accepts', () => {
    const long = { title: 't', statement: 'x'.repeat(1000), sourceFindingKey: 'k', linkedElements: [{ id: ID, name: 'A' }] };
    expect(designerInputFromPrefill(long)?.finding.length).toBeLessThanOrEqual(DESIGNER_MAX_FINDING_CHARS);
  });

  it('is null with no finding behind the form, or nothing linked', () => {
    expect(designerInputFromPrefill(null)).toBeNull();
    expect(designerInputFromPrefill({ title: 't', statement: 's', sourceFindingKey: '', linkedElements: [{ id: ID, name: 'A' }] })).toBeNull();
    expect(designerInputFromPrefill({ title: 't', statement: 's', sourceFindingKey: 'k', linkedElements: [] })).toBeNull();
  });
});

describe('canOfferDesigner', () => {
  const on = { assistantEnabled: true, agentsEnabled: true, keySet: true };
  it('is offered only to an owner or architect with every switch on and a key saved', () => {
    expect(canOfferDesigner({ role: 'owner', ...on })).toBe(true);
    expect(canOfferDesigner({ role: 'architect', ...on })).toBe(true);
    expect(canOfferDesigner({ role: 'contributor', ...on })).toBe(false);
    expect(canOfferDesigner({ role: 'viewer', ...on })).toBe(false);
    expect(canOfferDesigner({ role: null, ...on })).toBe(false);
    expect(canOfferDesigner({ role: 'owner', ...on, assistantEnabled: false })).toBe(false);
    expect(canOfferDesigner({ role: 'owner', ...on, agentsEnabled: false })).toBe(false);
    expect(canOfferDesigner({ role: 'owner', ...on, keySet: false })).toBe(false);
  });
});

describe('designerCostLine', () => {
  it('states tokens and lookups in words, with no money figure', () => {
    const line = designerCostLine({ inputTokens: 12345, outputTokens: 678, lookups: 4 });
    expect(line).toBe("This run used 12,345 tokens in and 678 out, with 4 lookups, on your organisation's AI key.");
    expect(line).not.toMatch(/[£$€]/);
  });
  it('says 1 lookup in the singular', () => {
    expect(designerCostLine({ inputTokens: 1, outputTokens: 1, lookups: 1 })).toContain('with 1 lookup,');
  });
});

describe('designerUnavailableReason', () => {
  const on = { assistantEnabled: true, agentsEnabled: true, keySet: true };
  it('is null when the Designer is offered', () => {
    expect(designerUnavailableReason({ role: 'owner', ...on })).toBeNull();
  });
  it('tells a contributor or viewer it is for owners and architects, with nothing to fix', () => {
    const reason = designerUnavailableReason({ role: 'contributor', ...on });
    expect(reason?.text).toMatch(/owners and architects/);
    expect(reason?.canFix).toBe(false);
  });
  it('names the first thing an owner or architect can switch on, in order', () => {
    expect(designerUnavailableReason({ role: 'owner', ...on, assistantEnabled: false })?.text).toMatch(/Ask Atlas/);
    expect(designerUnavailableReason({ role: 'architect', ...on, agentsEnabled: false })?.text).toMatch(/AI agents/);
    expect(designerUnavailableReason({ role: 'owner', ...on, keySet: false })?.text).toMatch(/AI key/);
    expect(designerUnavailableReason({ role: 'owner', ...on, keySet: false })?.canFix).toBe(true);
  });
});
