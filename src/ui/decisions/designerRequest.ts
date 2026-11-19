import type { UUID } from '../../contracts/delta';
import { DESIGNER_MAX_FINDING_CHARS } from '../../tools/designPrompt';
import type { DecisionPrefill } from './decisionPrefill';

/** What the Designer is asked about: the first thing the finding names, and the finding's own words (cut to the limit). `null` when no finding is behind the form. */
export function designerInputFromPrefill(prefill: DecisionPrefill | null): { elementId: UUID; finding: string } | null {
  if (!prefill || prefill.sourceFindingKey === '') return null;
  const first = prefill.linkedElements[0];
  if (!first) return null;
  const words = (prefill.statement.trim() !== '' ? prefill.statement : prefill.title).trim();
  const finding = words.length > DESIGNER_MAX_FINDING_CHARS ? `${words.slice(0, DESIGNER_MAX_FINDING_CHARS - 1).trimEnd()}…` : words;
  return { elementId: first.id, finding };
}

/** The same rule the function enforces, so the button is only offered when it can work. The function still checks every part. */
export function canOfferDesigner(args: { role: string | null; assistantEnabled: boolean; agentsEnabled: boolean; keySet: boolean }): boolean {
  return (args.role === 'owner' || args.role === 'architect') && args.assistantEnabled && args.agentsEnabled && args.keySet;
}

/**
 * Why the Designer is not offered, in one plain sentence, or `null` when it is
 * (Simon, 2026-11-19: a feature a person can't see doesn't exist for them, so a
 * missing button says why). `canFix` is true when the person can change the
 * setting themselves, so the page can link to it.
 */
export function designerUnavailableReason(args: { role: string | null; assistantEnabled: boolean; agentsEnabled: boolean; keySet: boolean }): { text: string; canFix: boolean } | null {
  if (canOfferDesigner(args)) return null;
  if (args.role !== 'owner' && args.role !== 'architect') {
    return { text: 'The Designer, which drafts options with AI, is available to owners and architects.', canFix: false };
  }
  if (!args.assistantEnabled) return { text: 'The Designer, which drafts options with AI, is off. Turn on Ask Atlas in organisation settings to use it.', canFix: true };
  if (!args.agentsEnabled) return { text: 'The Designer, which drafts options with AI, is off. Allow AI agents in organisation settings to use it.', canFix: true };
  return { text: 'The Designer, which drafts options with AI, needs your organisation\'s AI key. Save one in organisation settings to use it.', canFix: true };
}

/** "What did this cost": tokens and lookups, in words. No money figure, because Atlas holds no price list and a guessed price would read as a fact. */
export function designerCostLine(usage: { inputTokens: number; outputTokens: number; lookups: number }): string {
  const n = (v: number) => v.toLocaleString('en-GB');
  const lookups = usage.lookups === 1 ? '1 lookup' : `${n(usage.lookups)} lookups`;
  return `This run used ${n(usage.inputTokens)} tokens in and ${n(usage.outputTokens)} out, with ${lookups}, on your organisation's AI key.`;
}
