import type { Delta } from '../../contracts/delta';

/** A delta's own value, formatted for a one-line summary row — a bare string reads as itself, everything else as JSON so an object/number/boolean attribute value is still legible. `ElementUpdate<T>`'s per-type value can be `undefined` in its wire type even though `null` is the real "cleared" sentinel (SPEC §3.4) — both read the same here. */
function formatValue(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * One line describing what a delta did, for the change page's per-subject
 * delta list (Sprint C1 step 6). Deliberately doesn't show the value it
 * superseded — a wire `Delta` carries `previousDeltaId`, not the prior
 * value itself (SPEC §3.4: the delta *is* the current fact; the old one is
 * a separate row this summary doesn't fetch) — the element page's own
 * provenance history is where "what did this used to say" lives.
 */
export function describeDelta(delta: Delta): string {
  switch (delta.kind) {
    case 'element.create':
      return `Created — "${delta.name}"`;
    case 'element.update':
    case 'element.update_custom':
      return `${delta.attribute} → ${formatValue(delta.value)}`;
    case 'element.retract':
      return 'Retracted';
    case 'element.restore':
      return 'Restored';
    case 'relationship.create':
      return `Created (${delta.relationshipType})`;
    case 'relationship.update':
    case 'relationship.update_custom':
      return `${delta.attribute} → ${formatValue(delta.value)}`;
    case 'relationship.retract':
      return 'Retracted';
    case 'relationship.restore':
      return 'Restored';
  }
}
