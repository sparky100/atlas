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
 * `replaced_by` (retire only — snake_case, matching every other
 * multi-word column name in this format, e.g. `business_owner`) names the
 * system/module taking over: `buildImportCommit.ts` transfers every one of
 * the retiring element's own `supports` edges to it, `role: 'secondary'`,
 * the exact same shape and reasoning `useElementRetire.ts`'s own
 * "replaced by" picker already uses (never `'primary'` — promoting one
 * could collide with a primary edge the replacement already has elsewhere,
 * which this reconciliation pass has no reliable way to rule out either),
 * and writes a real `replaces` edge (ADR-001 amendment) from the
 * replacement to the retiring element via the same `buildReplacesDelta`
 * helper `useElementRetire.ts` and `buildReplaceWithNewElementDeltas.ts`
 * already call.
 *
 * `quote`/`confidence` — optional per-entry provenance an AI-authored
 * import can attach to any of the three sections alike (`importRowSchema.ts`/
 * `importRelationshipRow.ts` carry the identical pair): a supporting quote
 * from whatever the author is working from, and a confidence in [0,1].
 * Carried onto every delta this row produces (`buildImportCommit.ts`) —
 * `confidence` overriding the otherwise-hardcoded `1`, `quote` appended to
 * the delta's own `sourceRef` locator. Omitted entirely, they change
 * nothing (still `confidence: 1`, still a plain locator, exactly as before
 * this pair existed).
 *
 * Pure — no I/O, mirrors `importRelationshipRow.ts`'s own shape exactly:
 * `buildImportCommit.ts` resolves each row's `name`/`replaced_by` against
 * the model's own current systems/containers and builds the delta(s).
 */
export const CHANGE_IMPORT_COLUMNS = ['name', 'action', 'reason', 'replaced_by'] as const;
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
  /** `action: 'retire'` only (rejected on `restore` — validated below) — the replacement system/module's own name (or alias), resolved the same way `name` itself is (`buildImportCommit.ts`'s `resolveChangeTarget`). `null` means no replacement named: the retiring element's own `supports` edges are left alone, same as today. */
  replacedBy: string | null;
  /** A supporting quote from whatever the file's author is working from — free text, never validated beyond non-blank. */
  quote?: string | undefined;
  /** A confidence in [0,1] for this entry as a whole — overrides the otherwise-hardcoded `1` on every delta this row produces. */
  confidence?: number | undefined;
}

export type ImportChangeRowResult = { ok: true; row: ImportChangeRow } | { ok: false; rowNumber: number; error: string };

function cellToString(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return undefined;
  const str = String(raw).trim();
  return str.length > 0 ? str : undefined;
}

/** `confidence`'s own cell → a number in [0,1], or `undefined` for a genuinely blank cell — anything else (out of range, unparseable) is a real validation error, the same "never silently treat a typo as blank" stance `cellToBooleanWord` (`importRowSchema.ts`) already takes for `is_external`. */
function parseConfidence(raw: unknown): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: undefined };
  if (typeof raw === 'string' && raw.trim() === '') return { ok: true, value: undefined };
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(num) || num < 0 || num > 1) return { ok: false, error: 'must be a number between 0 and 1' };
  return { ok: true, value: num };
}

export function validateImportChangeRow(raw: Record<string, unknown>, rowNumber: number): ImportChangeRowResult {
  const name = cellToString(raw.name);
  if (name === undefined) return { ok: false, rowNumber, error: '"name" is required' };

  const actionCell = cellToString(raw.action);
  if (actionCell !== 'retire' && actionCell !== 'restore') return { ok: false, rowNumber, error: '"action" must be "retire" or "restore"' };

  const replacedBy = cellToString(raw.replaced_by) ?? null;
  if (replacedBy !== null && actionCell !== 'retire') return { ok: false, rowNumber, error: '"replaced_by" is only valid with action "retire"' };

  const confidenceResult = parseConfidence(raw.confidence);
  if (!confidenceResult.ok) return { ok: false, rowNumber, error: `"confidence": ${confidenceResult.error}` };

  return { ok: true, row: { rowNumber, name, action: actionCell, reason: cellToString(raw.reason) ?? null, replacedBy, quote: cellToString(raw.quote), confidence: confidenceResult.value } };
}
