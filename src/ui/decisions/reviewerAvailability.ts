import type { DecisionStatus, MemberRole } from '../../db/types';

export interface ReviewerAvailability {
  available: boolean;
  reason: string | null;
  canFix: boolean;
}

export function reviewerAvailability(args: { role: MemberRole | null; status: DecisionStatus; optionCount: number; assistantEnabled: boolean; agentsEnabled: boolean; keySet: boolean; ownerNames: readonly string[] }): ReviewerAvailability {
  const unavailable = (reason: string, canFix = false): ReviewerAvailability => ({ available: false, reason, canFix });
  if (args.status !== 'proposed') return unavailable('Second opinions are offered while a decision is still being weighed.');
  const owner = args.role === 'owner';
  const owners = args.ownerNames.length ? `an owner (${args.ownerNames.join(', ')})` : 'an owner';
  if (args.role !== 'owner' && args.role !== 'architect' && args.role !== 'contributor') return unavailable(`Second opinions are for contributors and above. Ask ${owners} to review this decision.`);
  if (args.optionCount === 0) return unavailable('Add an option to weigh before asking for a second opinion.');
  if (!args.assistantEnabled) return unavailable(owner ? 'Ask Atlas is off. Turn it on in organisation settings to ask for a second opinion.' : `Ask ${owners} to turn on Ask Atlas in organisation settings.`, owner);
  if (!args.agentsEnabled) return unavailable(owner ? 'AI agents are off. Allow agents in organisation settings to ask for a second opinion.' : `Ask ${owners} to allow AI agents in organisation settings.`, owner);
  if (!args.keySet) return unavailable(owner ? "Add your organisation's AI key in organisation settings to ask for a second opinion. The Designer trial does not include reviewers." : `Ask ${owners} to add the organisation's AI key in organisation settings. The Designer trial does not include reviewers.`, owner);
  return { available: true, reason: null, canFix: false };
}
