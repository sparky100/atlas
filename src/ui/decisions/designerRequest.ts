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

/** The roles that can run the Designer: the same floor as starting a decision (journey proposal section 6). The function and the AI proxy enforce it too. */
export function canRunDesignerRole(role: string | null): boolean {
  return role === 'owner' || role === 'architect' || role === 'contributor';
}

/** The same rule the function enforces, so the button is only offered when it can work. The function still checks every part. */
export function canOfferDesigner(args: { role: string | null; assistantEnabled: boolean; agentsEnabled: boolean; keySet: boolean }): boolean {
  return canRunDesignerRole(args.role) && args.assistantEnabled && args.agentsEnabled && args.keySet;
}

function whoCanSwitchOn(ownerNames: readonly string[]): string {
  return ownerNames.length === 0 ? 'An owner' : `An owner (${ownerNames.join(', ')})`;
}

/**
 * Why the Designer is not offered, in one plain sentence, or `null` when it is
 * (Simon, 2026-11-19: a feature a person can't see doesn't exist for them, so a
 * missing button says why and says who can act). `canFix` is true only for an
 * owner, because only owners can change these settings, so the page links to
 * them only for an owner and names the owners for everyone else.
 */
export function designerUnavailableReason(args: { role: string | null; assistantEnabled: boolean; agentsEnabled: boolean; keySet: boolean; ownerNames?: readonly string[] }): { text: string; canFix: boolean } | null {
  if (canOfferDesigner(args)) return null;
  if (!canRunDesignerRole(args.role)) {
    return { text: 'Suggesting options with AI is for contributors, architects and owners. Ask one of them to draft the options, or add them by hand.', canFix: false };
  }
  const isOwner = args.role === 'owner';
  const owners = whoCanSwitchOn(args.ownerNames ?? []);
  if (!args.assistantEnabled) return { text: isOwner ? 'Suggesting options with AI is off. Turn on Ask Atlas in organisation settings to use it.' : `Suggesting options with AI is off. ${owners} can turn on Ask Atlas in organisation settings. You can add options by hand meanwhile.`, canFix: isOwner };
  if (!args.agentsEnabled) return { text: isOwner ? 'Suggesting options with AI is off. Allow AI agents in organisation settings to use it.' : `Suggesting options with AI is off. ${owners} can allow AI agents in organisation settings. You can add options by hand meanwhile.`, canFix: isOwner };
  return { text: isOwner ? "Suggesting options with AI needs your organisation's AI key. Save one in organisation settings to use it." : `Suggesting options with AI needs the organisation's AI key. ${owners} can save one in organisation settings. You can add options by hand meanwhile.`, canFix: isOwner };
}

/** "What did this cost": tokens and lookups, in words. No money figure, because Atlas holds no price list and a guessed price would read as a fact. */
export function designerCostLine(usage: { inputTokens: number; outputTokens: number; lookups: number }): string {
  const n = (v: number) => v.toLocaleString('en-GB');
  const lookups = usage.lookups === 1 ? '1 lookup' : `${n(usage.lookups)} lookups`;
  return `This run used ${n(usage.inputTokens)} tokens in and ${n(usage.outputTokens)} out, with ${lookups}, on your organisation's AI key.`;
}
