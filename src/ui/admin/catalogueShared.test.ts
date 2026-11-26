import { describe, expect, it } from 'vitest';
import { claimDraftedText, claimStatusText, sameClaimText } from './catalogueShared';

const claim = { position: 1, kind: 'functional' as const, statement: 'A claim.', sourceUrl: 'https://example.com/a', sourceDate: '2026-11-21' };

describe('claim review wording', () => {
  it('says drafted and reviewed are different, with names and dates', () => {
    const drafted = claimStatusText({ reviewState: 'drafted', origin: 'person', draftedByName: 'Ada', draftedAt: '2026-11-26T10:00:00Z', reviewedByName: null, reviewedAt: null });
    expect(drafted).toBe('Waiting for review. Entered by Ada on 26 Nov 2026.');
    const reviewed = claimStatusText({ reviewState: 'reviewed', origin: 'person', draftedByName: 'Ada', draftedAt: '2026-11-26T10:00:00Z', reviewedByName: 'Bob', reviewedAt: '2026-11-27' });
    expect(reviewed).toBe('Reviewed by Bob on 27 Nov 2026. Entered by Ada on 26 Nov 2026.');
  });

  it('marks research-drafted and file-loaded claims as such', () => {
    expect(claimDraftedText('researcher', null, '2026-11-26T10:00:00Z')).toBe('Found by the Researcher on 26 Nov 2026');
    expect(claimDraftedText('imported', null, '2026-11-26T10:00:00Z')).toBe('Loaded from a file on 26 Nov 2026');
  });

  it('keeps a review only while the claim says the same thing', () => {
    expect(sameClaimText(claim, { ...claim, position: 3 })).toBe(true);
    expect(sameClaimText(claim, { ...claim, statement: 'Changed.' })).toBe(false);
    expect(sameClaimText(claim, { ...claim, sourceDate: '2026-11-22' })).toBe(false);
  });
});
