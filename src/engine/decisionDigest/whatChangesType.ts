import type { UUID } from '../../contracts/delta';

/** Shared display contract for the decision's derived comparison rows. */
export interface WhatChangesRow {
  id: string;
  groupLabel: string;
  rowLabel: string;
  main: { display: string; changed: boolean };
  options: ReadonlyMap<UUID, { display: string; changed: boolean }>;
  anyChanged: boolean;
}
