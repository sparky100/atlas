/** The database records "Decision cancelled: see decision <id>" when a decision takes its options with it. People read that sentence, so the id is dropped (the page already links the decision). */
export function cancelReasonText(reason: string): string {
  return reason.replace(/^Decision cancelled: see decision [0-9a-f-]{36}$/i, 'Its decision was cancelled.');
}
