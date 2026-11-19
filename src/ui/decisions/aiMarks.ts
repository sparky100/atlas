/**
 * The plain line that says an agent helped draft a decision (Simon,
 * 2026-11-19: "if AI agents are supporting this process it should be clearly
 * indicated"). One wording, used on the decision page, the approval pack and
 * the ADR export, so it reads the same wherever it appears. `null` when the
 * decision is fully human: nothing is shown then.
 */
const AGENT_NAMES: Readonly<Record<string, string>> = { designer: 'the Designer' };

export function aiMarkLine(mark: { ai_draft_agent: string | null; ai_drafted_at: string | null; ai_draft_edited: boolean }): string | null {
  if (mark.ai_draft_agent === null) return null;
  const agent = AGENT_NAMES[mark.ai_draft_agent] ?? 'an AI agent';
  const date = mark.ai_drafted_at === null ? null : new Date(mark.ai_drafted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const drafted = `Drafted by ${agent}${date !== null && date !== 'Invalid Date' ? ` on ${date}` : ''}`;
  return mark.ai_draft_edited ? `${drafted}, then edited by a person.` : `${drafted}. Not edited since.`;
}
