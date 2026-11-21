/**
 * The "What changes" row shape the ADR formatter reads — moved here from
 * `src/ui/decisions/whatChangesRows.ts` so the pure formatter (and, later,
 * the reviewer digest) can be imported by a server/edge module without
 * pulling in UI code. The builder in `whatChangesRows.ts` re-exports this
 * type, so the UI and the digest always agree on one shape.
 */
import type { UUID } from '../../contracts/delta';

export interface WhatChangesCell {
  display: string;
  changed: boolean;
}

export interface WhatChangesRow {
  id: string;
  /** The capability/system/container/stream name this row belongs under, or "Boundary crossings" — how the UI groups rows. */
  groupLabel: string;
  /** "Coverage" / "Lifecycle" / "Criticality" / "Fit" / "Outcome" / "Scoped crossings" / a value stream's own name. */
  rowLabel: string;
  main: WhatChangesCell;
  options: ReadonlyMap<UUID, WhatChangesCell>;
  /** `true` the moment any one option's value differs from main's. */
  anyChanged: boolean;
}
