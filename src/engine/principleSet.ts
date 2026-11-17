/**
 * Starter sets of principles (docs/ADR-034). Pure, no I/O — `src/db/principleSets.ts`
 * reads and writes. A set holds only the wording of each principle; copying it
 * into a model makes ordinary principles of the organisation's own, so every
 * copy is checked with the same limits as one typed by hand. Ids come from the
 * injected `mintId`, never `Math.random` (rule 6).
 */
import type { PrincipleSetPayload } from '../contracts/principleSet';
import { checkPrincipleInput, type PrincipleInput } from '../contracts/principles';
import type { UUID } from '../contracts/delta';

/** The wording of a model's active principles, A to Z by title, as a publishable payload. Retired ones are left out. */
export function buildPrincipleSetPayload(principles: readonly (PrincipleInput & { status: 'active' | 'retired' })[]): PrincipleSetPayload {
  const active = principles
    .filter((p) => p.status === 'active')
    .map((p) => ({ title: p.title.trim(), statement: p.statement.trim(), why: p.why.trim() }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { principles: active };
}

export interface PrincipleSetSource {
  slug: string;
  name: string;
  version: number;
}

export interface PlannedPrinciple extends PrincipleInput {
  id: UUID;
  from_set_slug: string;
  from_set_name: string;
  from_set_version: number;
}

export interface PrincipleSetCopyPlan {
  /** Rows to insert, in the order the set lists them. */
  rows: PlannedPrinciple[];
  /** Titles left out because the model already has an active or retired principle with that title (ignoring case). */
  alreadyThere: string[];
}

/**
 * Plans adding the principles at `picked` (positions in the set) to a model.
 * A principle whose title the model already uses is skipped, not duplicated, so
 * adding the same set twice changes nothing. Positions outside the set are ignored.
 */
export function planPrincipleSetCopy(payload: PrincipleSetPayload, source: PrincipleSetSource, picked: readonly number[], existingTitles: readonly string[], mintId: () => UUID): PrincipleSetCopyPlan {
  const taken = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  const wanted = new Set(picked);
  const rows: PlannedPrinciple[] = [];
  const alreadyThere: string[] = [];
  payload.principles.forEach((principle, index) => {
    if (!wanted.has(index)) return;
    const checked = checkPrincipleInput(principle);
    if (!checked.ok) return; // The table's own checks guarantee a stored set passes; never write one that would not.
    const key = checked.value.title.toLowerCase();
    if (taken.has(key)) {
      alreadyThere.push(checked.value.title);
      return;
    }
    taken.add(key);
    rows.push({ id: mintId(), ...checked.value, from_set_slug: source.slug, from_set_name: source.name, from_set_version: source.version });
  });
  return { rows, alreadyThere };
}
