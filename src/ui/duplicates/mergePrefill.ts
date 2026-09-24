import type { UUID } from '../../contracts/delta';

/**
 * F4 (ADR-019 "Amended (F4, ...)"): the duplicates report's own "Merge
 * into…" row action — same URL-search-param convention as
 * `decisionPrefill.ts` (a real, shareable link, not router state). The
 * element page (`ElementPage.tsx`) reads this once, on landing, to open its
 * `MergeIntoAction` panel already pointed at the other candidate rather than
 * making the architect search for it again.
 */
export interface MergePrefill {
  targetId: UUID;
  targetName: string;
}

const TARGET_ID_PARAM = 'mergeTargetId';
const TARGET_NAME_PARAM = 'mergeTargetName';

/** Appended to an `/e/{elementId}` href — `URLSearchParams` handles the encoding, so callers never need to. */
export function mergePrefillToSearchParams(prefill: MergePrefill): URLSearchParams {
  const params = new URLSearchParams();
  params.set(TARGET_ID_PARAM, prefill.targetId);
  params.set(TARGET_NAME_PARAM, prefill.targetName);
  return params;
}

/** The inverse of `mergePrefillToSearchParams` — `null` unless both fields are present (a bare `/e/{id}` link opens with no merge panel, same as before this feature). */
export function parseMergePrefillFromSearchParams(params: URLSearchParams): MergePrefill | null {
  const targetId = params.get(TARGET_ID_PARAM);
  const targetName = params.get(TARGET_NAME_PARAM);
  if (targetId === null || targetName === null) return null;
  return { targetId, targetName };
}
