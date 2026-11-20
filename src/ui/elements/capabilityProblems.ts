import type { UUID } from '../../contracts/delta';
import type { FitForPurpose } from '../../contracts/delta';

/**
 * What needs attention on a capability page, in plain sentences, most serious first. Read from what is recorded
 * (the fit rating and fit note on each `supports` link, and the key facts still missing) and stored nowhere.
 * A poor fit is a prompt to decide, never a verdict: the wording never says replace or retire.
 */
export type CapabilityProblemKind = 'poor-fit' | 'no-supporter' | 'fit-unrated' | 'missing-facts';

export interface CapabilityProblem {
  kind: CapabilityProblemKind;
  /** One plain sentence. */
  text: string;
  /** The recorded reason (a poor fit's note), when there is one. */
  reason: string | null;
  /** The system a poor-fit or unrated item is about; its name appears in `text`. */
  systemId: UUID | null;
  systemName: string | null;
}

export interface CapabilitySupporter {
  systemId: UUID;
  name: string;
  fit: FitForPurpose | null;
  /** The fit note on the link, `''` when none. */
  note: string;
}

export function capabilityProblems(args: { supporters: readonly CapabilitySupporter[]; missingFactsText: string }): CapabilityProblem[] {
  const { supporters, missingFactsText } = args;
  const problems: CapabilityProblem[] = [];
  for (const s of supporters) {
    if (s.fit !== 'poor') continue;
    const note = s.note.trim();
    problems.push({
      kind: 'poor-fit',
      text: note !== '' ? `${s.name} is a poor fit.` : `${s.name} is rated a poor fit, but no reason is recorded.`,
      reason: note !== '' ? note : null,
      systemId: s.systemId,
      systemName: s.name,
    });
  }
  if (supporters.length === 0) {
    problems.push({ kind: 'no-supporter', text: 'No system is recorded as supporting this capability.', reason: null, systemId: null, systemName: null });
  }
  for (const s of supporters) {
    if (s.fit === null) problems.push({ kind: 'fit-unrated', text: `How well ${s.name} fits this capability has not been rated.`, reason: null, systemId: s.systemId, systemName: s.name });
  }
  if (missingFactsText !== '') {
    problems.push({ kind: 'missing-facts', text: `Key facts still missing: ${missingFactsText}.`, reason: null, systemId: null, systemName: null });
  }
  return problems;
}

/** Which action the band offers. A real problem (poor fit, no supporter, unrated fit) is the start of a project; only missing facts is a fill-in. */
export function bandAction(problems: readonly CapabilityProblem[]): 'project' | 'fill-in' | null {
  if (problems.length === 0) return null;
  return problems.some((p) => p.kind !== 'missing-facts') ? 'project' : 'fill-in';
}
