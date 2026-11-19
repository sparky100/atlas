/**
 * Plain words for the health finding a project or decision started from
 * (`source_finding_key`, a stable string: ADR-022). `null` for a key this
 * version doesn't know, so an old or custom key shows nothing rather than its
 * raw string.
 */
const LABELS: Readonly<Record<string, string>> = {
  'capability-no-supporters': 'a capability nothing supports',
  'critical-exposed': 'a critical system with exposure',
  'critical-support-end': 'a critical system past or near its vendor support end',
  'outgoing-no-retiring-change': 'a system going out with no change retiring it',
  'poor-fit-director': 'a capability with poor-fit support',
  'unlinked-systems': 'a system with no capability link recorded',
  'weak-capability': 'a weakly supported capability',
  'weak-stage': 'a weak stage in a value stream',
};

export function findingLabel(key: string | null): string | null {
  if (key === null) return null;
  return LABELS[key] ?? null;
}
