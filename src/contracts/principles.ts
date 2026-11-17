/**
 * Architecture principles (ADR-034, `docs/ADR-034-principles.md`,
 * `supabase/migrations/20261117100000_principles.sql`).
 *
 * A principle is a short rule a team agrees decisions will be checked
 * against. A decision says which principles it follows and which it departs
 * from; a departure always carries a reason. Workflow records, never model
 * facts: no logic or I/O here, only the stored shapes and the limits the
 * table's check constraints enforce, so the form can refuse early and the
 * database remains the real gate.
 */

export const PRINCIPLE_STATUSES = ['active', 'retired'] as const;
export type PrincipleStatus = (typeof PRINCIPLE_STATUSES)[number];

export const PRINCIPLE_STANCES = ['follows', 'departs'] as const;
export type PrincipleStance = (typeof PRINCIPLE_STANCES)[number];

/** Mirror the `check (length(...) <= n)` constraints in the migration. */
export const PRINCIPLE_LIMITS = { title: 120, statement: 500, why: 1000, reason: 500 } as const;

export interface PrincipleInput {
  title: string;
  statement: string;
  why: string;
}

export type PrincipleInputProblem = 'title-empty' | 'title-too-long' | 'statement-empty' | 'statement-too-long' | 'why-too-long';

/** Trims the fields and reports the first thing wrong, in the order the form shows them. */
export function checkPrincipleInput(input: PrincipleInput): { ok: true; value: PrincipleInput } | { ok: false; problem: PrincipleInputProblem } {
  const value = { title: input.title.trim(), statement: input.statement.trim(), why: input.why.trim() };
  if (value.title.length === 0) return { ok: false, problem: 'title-empty' };
  if (value.title.length > PRINCIPLE_LIMITS.title) return { ok: false, problem: 'title-too-long' };
  if (value.statement.length === 0) return { ok: false, problem: 'statement-empty' };
  if (value.statement.length > PRINCIPLE_LIMITS.statement) return { ok: false, problem: 'statement-too-long' };
  if (value.why.length > PRINCIPLE_LIMITS.why) return { ok: false, problem: 'why-too-long' };
  return { ok: true, value };
}

/** A departure must say why; following need not. Mirrors `decision_principles_departure_has_reason`. */
export function isValidStanceReason(stance: PrincipleStance, reason: string): boolean {
  if (reason.length > PRINCIPLE_LIMITS.reason) return false;
  return stance === 'follows' || reason.trim().length > 0;
}

/** The literal shape of a row in `principles`. Retired, never deleted; `retired_*` are stamped by the database. */
export interface PrincipleRow {
  id: string;
  org_id: string;
  model_id: string;
  title: string;
  /** The rule, in one or two plain sentences. */
  statement: string;
  /** Why a team would accept it. */
  why: string;
  status: PrincipleStatus;
  created_by: string;
  created_at: string;
  retired_by: string | null;
  retired_at: string | null;
}

/** The literal shape of a row in `decision_principles` — primary key `(decision_id, principle_id)`. */
export interface DecisionPrincipleRow {
  decision_id: string;
  principle_id: string;
  stance: PrincipleStance;
  /** Required (non-blank) when `stance` is `departs`. */
  reason: string;
  created_by: string;
  created_at: string;
}

/** Display words — one place, so every page names the two stances the same way. */
export function principleStanceLabel(stance: PrincipleStance): string {
  return stance === 'follows' ? 'Follows' : 'Departs from';
}
