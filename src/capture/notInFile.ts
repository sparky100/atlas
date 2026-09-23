/**
 * "Elements in the model but absent from the file/document a capture run
 * covered, listed as 'not in file' (a question, never a retraction)."
 * Pure — one function, reused for the same comparison in two places:
 *
 *  - In the capture review queue, right after matching, from the run's own
 *    touched-element-id set (`useCaptureReviewQueue.ts`).
 *  - On the change page, for a historical F2-lite-sourced import, reading
 *    back `sources.import_touched_element_ids`
 *    (`20260918010000_import_touched_element_ids.sql`) — the durable record
 *    of which element ids that import run's own rows matched or created.
 *
 * Scoped to exactly the universe a spreadsheet/JSON capture run can ever
 * address — top-level systems and a platform's own modules — never a
 * standalone container and never actors/capabilities (referenced by a row,
 * never this row's own subject).
 */
import type { UUID } from '../contracts/delta';
import type { ElementsHeadRow } from '../contracts/rows';

/** A system's own `kind === 'platform'` — the same check `src/ui/elements/systemKind.ts`'s `isPlatform` makes, reimplemented rather than imported: `src/capture` is a pipeline stage `src/ui` depends on, never the other way (CLAUDE.md's own layering — crossing it here would be working around the layering, not a sign it's wrong). */
function isPlatformSystem(system: ElementsHeadRow): boolean {
  const attributes = system.attributes;
  const kind = attributes !== null && typeof attributes === 'object' && !Array.isArray(attributes) ? (attributes as Record<string, unknown>).kind : undefined;
  return kind === 'platform';
}

export interface NotInFileElement {
  elementId: UUID;
  name: string;
  elementType: 'system' | 'container';
}

/** `systems`/`containers` are the model's own current head rows (any kind/parent — this function does its own filtering); `touchedElementIds` is the import run's own touched set (`sources.import_touched_element_ids`, or the in-memory equivalent while still in the dialog). Result order: systems first, then modules, each by name — a stable, readable list, not matching either input's own row order. */
export function computeNotInFile(systems: readonly ElementsHeadRow[], containers: readonly ElementsHeadRow[], touchedElementIds: ReadonlySet<UUID>): NotInFileElement[] {
  const platformIds = new Set(systems.filter(isPlatformSystem).map((s) => s.element_id));
  const candidates: NotInFileElement[] = [
    ...systems.map((s): NotInFileElement => ({ elementId: s.element_id, name: s.name, elementType: 'system' })),
    ...containers.filter((c) => c.parent_id !== null && platformIds.has(c.parent_id)).map((c): NotInFileElement => ({ elementId: c.element_id, name: c.name, elementType: 'container' })),
  ];
  return candidates.filter((c) => !touchedElementIds.has(c.elementId)).sort((a, b) => (a.elementType === b.elementType ? a.name.localeCompare(b.name) : a.elementType === 'system' ? -1 : 1));
}
