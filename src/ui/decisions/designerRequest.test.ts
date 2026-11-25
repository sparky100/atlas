import { describe, expect, it } from 'vitest';
import { DESIGNER_MAX_FINDING_CHARS } from '../../tools/designPrompt';
import { prefillFromSystemWithoutCapability } from './decisionPrefill';
import { canOfferDesigner, designerBriefText, designerCostLine, designerTrialLine, designerInputFromPrefill, designerUnavailableReason } from './designerRequest';

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
  it('is offered to an owner, architect or contributor with every switch on and a key saved', () => {
    expect(canOfferDesigner({ role: 'owner', ...on })).toBe(true);
    expect(canOfferDesigner({ role: 'architect', ...on })).toBe(true);
    expect(canOfferDesigner({ role: 'contributor', ...on })).toBe(true);
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
  it('adds the billed web searches when the run used any, without a money figure', () => {
    const line = designerCostLine({ inputTokens: 1, outputTokens: 1, lookups: 1, webSearches: 2 });
    expect(line).toContain('with 1 lookup, 2 web searches,');
    expect(designerCostLine({ inputTokens: 1, outputTokens: 1, lookups: 1, webSearches: 1 })).toContain('1 web search,');
    expect(line).not.toMatch(/[£$€]/);
  });
});

describe('designerUnavailableReason', () => {
  const on = { assistantEnabled: true, agentsEnabled: true, keySet: true };
  it('is null when the Designer is offered', () => {
    expect(designerUnavailableReason({ role: 'owner', ...on })).toBeNull();
  });
  it('tells a viewer it is for contributors and above, with nothing to fix', () => {
    const reason = designerUnavailableReason({ role: 'viewer', ...on });
    expect(reason?.text).toMatch(/contributors, architects and owners/);
    expect(reason?.canFix).toBe(false);
  });
  it('names the first thing that is switched off, in order, and links to settings only for an owner', () => {
    expect(designerUnavailableReason({ role: 'owner', ...on, assistantEnabled: false })?.text).toMatch(/Ask Atlas/);
    expect(designerUnavailableReason({ role: 'owner', ...on, agentsEnabled: false })?.text).toMatch(/AI agents/);
    expect(designerUnavailableReason({ role: 'owner', ...on, keySet: false })?.text).toMatch(/AI key/);
    expect(designerUnavailableReason({ role: 'owner', ...on, keySet: false })?.canFix).toBe(true);
    for (const role of ['architect', 'contributor']) {
      expect(designerUnavailableReason({ role, ...on, keySet: false })?.canFix).toBe(false);
    }
  });
  it('names the owners who can act, for someone who cannot', () => {
    const r = designerUnavailableReason({ role: 'architect', ...on, agentsEnabled: false, ownerNames: ['Alex', 'Priya'] });
    expect(r?.text).toContain('An owner (Alex, Priya) can allow AI agents');
    expect(designerUnavailableReason({ role: 'contributor', ...on, assistantEnabled: false })?.text).toContain('An owner can turn on Ask Atlas');
  });
});

describe('the free trial', () => {
  const noKey = { assistantEnabled: true, agentsEnabled: true, keySet: false };
  it('offers the Designer without a key while trial runs are left, and not once they are gone', () => {
    expect(canOfferDesigner({ role: 'contributor', ...noKey, trial: { runsLeft: 3, runsUsed: 2 } })).toBe(true);
    expect(canOfferDesigner({ role: 'contributor', ...noKey, trial: { runsLeft: 0, runsUsed: 5 } })).toBe(false);
    expect(canOfferDesigner({ role: 'contributor', ...noKey })).toBe(false);
    expect(canOfferDesigner({ role: 'viewer', ...noKey, trial: { runsLeft: 3, runsUsed: 2 } })).toBe(false);
  });
  it('names the owners to a member when the trial is used up, and links only an owner to settings', () => {
    const member = designerUnavailableReason({ role: 'contributor', ...noKey, trial: { runsLeft: 0, runsUsed: 5 }, ownerNames: ['Sam Owner', 'Pat Owner'] });
    expect(member?.text).toContain('free trial');
    expect(member?.text).toContain('Sam Owner, Pat Owner');
    expect(member?.canFix).toBe(false);
    const owner = designerUnavailableReason({ role: 'owner', ...noKey, trial: { runsLeft: 0, runsUsed: 5 } });
    expect(owner?.canFix).toBe(true);
  });
  it('names the owners when there is no key and no trial was ever used', () => {
    expect(designerUnavailableReason({ role: 'architect', ...noKey, ownerNames: ['Sam Owner'] })?.text).toContain('Ask an owner (Sam Owner)');
  });
  it('shows runs left beside the button, and nothing once the organisation has its own key', () => {
    expect(designerTrialLine({ keySet: false, trial: { runsLeft: 3, runsUsed: 2 }, ownerNames: ['Sam Owner'] })).toContain('3 drafts left');
    expect(designerTrialLine({ keySet: false, trial: { runsLeft: 1, runsUsed: 4 } })).toContain('1 draft left');
    expect(designerTrialLine({ keySet: false, trial: { runsLeft: 0, runsUsed: 5 }, ownerNames: ['Sam Owner'] })).toContain('Sam Owner');
    expect(designerTrialLine({ keySet: true, trial: { runsLeft: 3, runsUsed: 2 } })).toBeNull();
  });
  it('says a trial run used the free trial, not the organisation key', () => {
    expect(designerCostLine({ inputTokens: 1, outputTokens: 1, lookups: 1, trial: true })).toContain("Atlas's free trial");
  });
});

describe('designerBriefText', () => {
  it('sends the need, then the outcome, and falls back to the title', () => {
    expect(designerBriefText('Quotes are slow.', 'Quotes in two days by March 2027', 'Title')).toBe('Quotes are slow.\nOutcome we want: Quotes in two days by March 2027');
    expect(designerBriefText('  ', '', 'Which quote tool?')).toBe('Which quote tool?');
    expect(designerBriefText('Quotes are slow.', '   ', 'Title')).toBe('Quotes are slow.');
  });
});
