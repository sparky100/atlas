/**
 * Choosing an option is limited to owners and architects. Someone who cannot choose is told so, and who can,
 * instead of finding no Choose button and no explanation (CLAUDE.md rule 7: say who can take a restricted action).
 */
export function chooseNote(approverNames: readonly string[]): string {
  const names = approverNames.length > 0 ? `: ${approverNames.join(', ')}` : '';
  return `Only an owner or architect can choose an option${names}. You can rate and edit options.`;
}
