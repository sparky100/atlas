/**
 * Share links: the address a person copies to send someone else to the
 * page they are looking at. Pages already keep their view state in the
 * URL (filters, mode, capability focus), so a share link is the current
 * URL minus the sender's *personal* state:
 *
 * - `ref`/`viewing`/`mode` describe the sender's selected change, which the
 *   recipient may not be able to see. They are dropped by default, so the
 *   link opens the main model. `tag:` and `commit:` refs are explicit
 *   views of recorded history, not a personal selection, so they stay.
 * - "This change" keeps the branch ref but always marks it read-only
 *   (`viewing=1`), so opening the link never makes the recipient's
 *   editing selection that change.
 */
export type ShareTarget = 'main' | 'change';

export function buildShareUrl(origin: string, pathname: string, search: string, target: ShareTarget): string {
  const params = new URLSearchParams(search);
  const ref = params.get('ref') ?? '';
  const isBranch = ref.startsWith('branch:');
  if (isBranch && target === 'change') {
    params.set('viewing', '1');
  } else if (isBranch) {
    params.delete('ref');
    params.delete('viewing');
    params.delete('mode');
  }
  const query = params.toString();
  return `${origin}${pathname}${query ? `?${query}` : ''}`;
}

export function isOnChange(search: string): boolean {
  return (new URLSearchParams(search).get('ref') ?? '').startsWith('branch:');
}
