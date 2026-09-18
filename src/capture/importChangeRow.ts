/**
 * F2-lite JSON import — the "changes" section: explicit retire/restore
 * declarations for elements this import's author already knows about,
 * distinct from the Systems section's own rows (which can only ever assert
 * "this exists"). A CSV/XLSX import has no equivalent — it only ever infers
 * "not in file" from omission (`notInFile.ts`) and leaves retiring to a
 * manual follow-up on the change page (`useImportSummary.ts`); JSON can
 * state a retirement on purpose instead.
 *
 * `action: 'retire'` sets `lifecycleStatus: 'retired'`, the same value (and
 * the same plain `element.update`, no `element.retract`) the change page's
 * own "not in file" retire shortcut already uses — a reconciliation import
 * reporting "this no longer exists", not the separate, stronger "remove
 * from model" action (`useElementRemoveFromModel.ts`) for undoing a mistaken
 * create. `action: 'restore'` is its exact inverse: `lifecycleStatus:
 * 'active'`, undoing an earlier retirement.
 *
 * Pure — no I/O, mirrors `importRelationshipRow.ts`'s own shape exactly:
 * `buildImportCommit.ts` resolves each row's `name` against the model's own
 * current systems/containers and builds the delta.
 */
export const CHANGE_IMPORT_COLUMNS = ['name', 'action', 'reason'] as const;
export type ChangeImportColumn = (typeof CHANGE_IMPORT_COLUMNS)[number];

export type ImportChangeAction = 'retire' | 'restore';

export interface ImportChangeRow {
  /** 1-based entry number within the "changes" array — for error messages and per-delta `sourceRef`, never used as an id (mirrors `ImportRow.rowNumber`/`ImportRelationshipRow.rowNumber`). */
  rowNumber: number;
  /** The target system or module's own name (or alias) — an existing element only; a change row never creates anything. */
  name: string;
  action: ImportChangeAction;
  /** Free text — never affects the delta itself, just carried through to the review UI so a reviewer can see why the file's author asked for this. */
  reason: string | null;
}

export type ImportChangeRowResult = { ok: true; row: ImportChangeRow } | { ok: false; rowNumber: number; error: string };

function cellToString(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return undefined;
  const str = String(raw).trim();
  return str.length > 0 ? str : undefined;
}

export function validateImportChangeRow(raw: Record<string, unknown>, rowNumber: number): ImportChangeRowResult {
  const name = cellToString(raw.name);
  if (name === undefined) return { ok: false, rowNumber, error: '"name" is required' };

  const actionCell = cellToString(raw.action);
  if (actionCell !== 'retire' && actionCell !== 'restore') return { ok: false, rowNumber, error: '"action" must be "retire" or "restore"' };

  return { ok: true, row: { rowNumber, name, action: actionCell, reason: cellToString(raw.reason) ?? null } };
}
