/**
 * Prompt 7k item 3's IT/OT domain — the one `domainOf`/`resolveElementDomain`
 * pair every consumer (the landscape's OT zone and colour-by, the
 * capability map's "OT share" colour-by, the boundary-crossings finding
 * and list) reads through, so "what domain is this element" is answered
 * once, not re-derived per call site.
 */
import type { ElementsHeadRow } from '../../contracts/rows';
import type { SystemDomain } from '../../contracts/delta';
import type { ChipTone } from '../components/Chip/Chip';
import { attributesRecord } from './attributesRecord';

/**
 * `it`/`hybrid` are unmarked (`neutral`) — the common case for a
 * regulated estate is IT, and `hybrid` genuinely straddles both, so
 * neither reads as "needs attention" the way `ot` does: an OT system is
 * exactly the fact the IT/OT colour-by and the boundary-crossings finding
 * exist to make visible, so it gets `warn` — not "OT is bad", but "this is
 * the fact worth a second look in a regulated estate", the same "needs
 * attention" reading `metric:supportingSystemCount`'s own zero-count
 * `warn` already uses for a different fact.
 */
export const DOMAIN_TONE: Record<SystemDomain, ChipTone> = { it: 'neutral', ot: 'neutral', hybrid: 'neutral' };

export function domainToneFor(value: string): ChipTone | undefined {
  return value in DOMAIN_TONE ? DOMAIN_TONE[value as SystemDomain] : undefined;
}

/**
 * A system's own `domain`, defaulting to `'it'` when absent or not a
 * recognised value (`SystemDomain`'s own doc comment, `delta.ts`) — never
 * written back, just how every reader treats the gap. Only meaningful for
 * a System; a Container's domain is `resolveElementDomain`'s job below,
 * since it doesn't carry the attribute itself.
 */
export function domainOf(system: ElementsHeadRow): SystemDomain {
  const value = attributesRecord(system.attributes).domain;
  return value === 'ot' || value === 'hybrid' ? value : 'it';
}

/**
 * The domain a `uses`/`flows_to` endpoint resolves to for boundary-crossing
 * purposes — a System reads its own `domain` (`domainOf`). A Container
 * checks its *own* `domain` first ("platforms and modules": a platform's
 * module can now carry its own override, `ContainerAttributes.domain`'s
 * own doc comment) before inheriting by walking `parent_id` up until a
 * System is reached (a Container's parent is always a System, per
 * `relationshipTypeRules.ts`'s own hierarchy — so exactly one hop). An
 * element missing from `elementsById` (shouldn't happen for a live edge's
 * own endpoints, but `listUsesAndFlowsToEndpointElements`'s own
 * caller-supplied scope could in principle miss one) or a chain that never
 * reaches a System defaults to `'it'`, the same "absent reads as it" stance
 * `domainOf` takes. Fully backward-compatible: an ordinary Container that
 * never sets `domain` (every one before this feature, and most after it)
 * falls straight through to the parent walk exactly as before.
 */
export function resolveElementDomain(element: ElementsHeadRow, elementsById: ReadonlyMap<string, ElementsHeadRow>): SystemDomain {
  let current: ElementsHeadRow | undefined = element;
  // Bounded by the taxonomy's own fixed depth (system → container,
  // ADR-000) — never an unbounded walk of caller-supplied data. One hop
  // of margin above the exact depth, same conservative-not-exact stance
  // this bound already took before S1 item 18 shortened the chain.
  for (let hop = 0; hop < 3 && current; hop++) {
    // system-only: a system carries its own domain; a module takes its own value or walks up to its platform.
    if (current.element_type === 'system') return domainOf(current);
    const ownValue = attributesRecord(current.attributes).domain;
    if (ownValue === 'ot' || ownValue === 'hybrid') return ownValue;
    current = current.parent_id !== null ? elementsById.get(current.parent_id) : undefined;
  }
  return 'it';
}
