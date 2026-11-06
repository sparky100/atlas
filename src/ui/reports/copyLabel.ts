/** ADR-027 (F14 step 5): the "as at <date>, <commit>" label every opened saved copy carries. Pure. */
export function formatCopyDate(iso: string): string {
  return iso.slice(0, 10);
}

export function shortCommit(commitId: string): string {
  return commitId.slice(0, 8);
}

export function copyLabel(generatedAt: string, commitId: string): string {
  return `as at ${formatCopyDate(generatedAt)}, ${shortCommit(commitId)}`;
}
