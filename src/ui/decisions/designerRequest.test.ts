import { describe, expect, it } from 'vitest';
import { DESIGNER_MAX_FINDING_CHARS } from '../../tools/designPrompt';
import { prefillFromSystemWithoutCapability } from './decisionPrefill';
import { canOfferDesigner, designerInputFromPrefill } from './designerRequest';

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
