import type { Delta, ReplacesAttributes, UUID } from '../contracts/delta';

export interface BuildReplacesDeltaOptions {
  attributes?: ReplacesAttributes;
  /** Locator inside the source (`Provenance.sourceRef`) — omitted (not set at all) when the caller has none, the same convention `Provenance` itself documents. */
  sourceRef?: string;
  /** Defaults to 1 (a manual edit's own confidence) — a caller with its own per-row confidence (F2-lite import, the capture pipeline) passes it through instead. */
  confidence?: number;
}

/**
 * ADR-001 amendment: one `replaces` `relationship.create` delta —
 * `fromElementId` is the replacement, `toElementId` is the retiring
 * element ("B replaces A" is `from: B, to: A`). A create delta needs no
 * `Head`/fact lookup (no `previousDeltaId` the way retract/update need),
 * so unlike `mergeElements.ts`'s own private per-kind delta builders this
 * one is exported and free-standing — every write path that produces a
 * `replaces` edge (Retire…, replace-with-new-element, F2-lite import,
 * the capture pipeline) calls this same function, so they converge on one
 * delta shape by construction rather than by convention.
 */
export function buildReplacesDelta(fromElementId: UUID, toElementId: UUID, sourceId: UUID, options: BuildReplacesDeltaOptions = {}): Delta {
  const { attributes = {}, sourceRef, confidence = 1 } = options;
  return {
    kind: 'relationship.create',
    id: crypto.randomUUID(),
    relationshipId: crypto.randomUUID(),
    relationshipType: 'replaces',
    fromElementId,
    toElementId,
    attributes,
    sourceId,
    ...(sourceRef !== undefined ? { sourceRef } : {}),
    confidence,
  };
}
