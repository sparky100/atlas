/**
 * F2-lite JSON import — the "value_streams" section (F6/ADR-023): explicit
 * value-stream declarations, distinct from the Systems section's own rows.
 * A CSV/XLSX import has no equivalent (it has no section to carry one), so
 * `valueStreamRows`/`valueStreamErrors` are always empty for a spreadsheet.
 *
 * Shape: `{ name, stages: [{ name, enables: [capability name, ...] }] }` —
 * a stream by name (matched among the model's root `value_stream`s by exact
 * name, or created new), its stages (matched by name within that stream, or
 * created), and each stage's `enables` naming the capabilities that deliver
 * it by *name* (the same by-name convention the starter-map content uses;
 * resolved against the model's capabilities by `matchImportValueStreams`).
 *
 * Deliberately leaner than `importRowSchema.ts`'s rows: no `quote`/
 * `confidence`, no per-stage description/order — a value stream is a
 * grouping label, not a system with attributes, and its `order` is derived
 * from file position (`buildImportCommit.ts`) rather than authored.
 *
 * Pure — no I/O, mirrors `importRelationshipRow.ts`/`importChangeRow.ts`.
 */
export interface ImportValueStreamStageRow {
  name: string;
  /** The capabilities that deliver this stage, by name — may be empty (a stage with no recorded enabler is legal; it just reads "neutral"). */
  enables: string[];
}

export interface ImportValueStreamRow {
  /** 1-based entry number within the "value_streams" array — for error messages and per-delta `sourceRef`, never used as an id. */
  rowNumber: number;
  name: string;
  stages: ImportValueStreamStageRow[];
}

export type ImportValueStreamRowResult = { ok: true; row: ImportValueStreamRow } | { ok: false; rowNumber: number; error: string };

function cellToString(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return undefined;
  const str = String(raw).trim();
  return str.length > 0 ? str : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Array.isArray`, narrowed to `unknown[]` rather than TS's own `any[]` (a known `Array.isArray` limitation) so an indexed element can't leak an `any` into this module's otherwise-typed logic. */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function validateImportValueStreamRow(raw: Record<string, unknown>, rowNumber: number): ImportValueStreamRowResult {
  const name = cellToString(raw.name);
  if (name === undefined) return { ok: false, rowNumber, error: '"name" is required' };

  const rawStages = raw.stages;
  if (!isUnknownArray(rawStages) || rawStages.length === 0) return { ok: false, rowNumber, error: '"stages" must be a non-empty array' };

  const stages: ImportValueStreamStageRow[] = [];
  for (let i = 0; i < rawStages.length; i++) {
    const rawStage = rawStages[i];
    if (!isPlainObject(rawStage)) return { ok: false, rowNumber, error: `"stages"[${String(i)}] must be an object` };
    const stageName = cellToString(rawStage.name);
    if (stageName === undefined) return { ok: false, rowNumber, error: `"stages"[${String(i)}].name is required` };

    const rawEnables = rawStage.enables;
    if (!isUnknownArray(rawEnables)) return { ok: false, rowNumber, error: `"stages"[${String(i)}].enables must be an array` };
    const enables: string[] = [];
    for (const enable of rawEnables) {
      const enableName = cellToString(enable);
      if (enableName === undefined) return { ok: false, rowNumber, error: `"stages"[${String(i)}].enables entries must be non-empty strings` };
      enables.push(enableName);
    }
    stages.push({ name: stageName, enables });
  }

  return { ok: true, row: { rowNumber, name, stages } };
}
