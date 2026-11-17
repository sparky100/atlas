/**
 * Goals (ADR-035, `docs/ADR-035-goals.md`,
 * `supabase/migrations/20261117200000_goals.sql`).
 *
 * A goal is a short statement of what the organisation is trying to achieve,
 * linked to the capabilities that serve it, so people can see why a capability
 * matters. A workflow record, never a model fact and not an element type
 * (ADR-001): no logic or I/O here, only the stored shapes and the limits the
 * table's check constraints enforce, so the form can refuse early and the
 * database remains the real gate.
 */

export const GOAL_STATUSES = ['active', 'retired'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Mirror the `check (length(...) <= n)` constraints in the migration. */
export const GOAL_LIMITS = { title: 120, statement: 500, whyNow: 500 } as const;

export interface GoalInput {
  title: string;
  statement: string;
  whyNow: string;
}

export type GoalInputProblem = 'title-empty' | 'title-too-long' | 'statement-empty' | 'statement-too-long' | 'why-now-too-long';

/** Trims the fields and reports the first thing wrong, in the order the form shows them. */
export function checkGoalInput(input: GoalInput): { ok: true; value: GoalInput } | { ok: false; problem: GoalInputProblem } {
  const value = { title: input.title.trim(), statement: input.statement.trim(), whyNow: input.whyNow.trim() };
  if (value.title.length === 0) return { ok: false, problem: 'title-empty' };
  if (value.title.length > GOAL_LIMITS.title) return { ok: false, problem: 'title-too-long' };
  if (value.statement.length === 0) return { ok: false, problem: 'statement-empty' };
  if (value.statement.length > GOAL_LIMITS.statement) return { ok: false, problem: 'statement-too-long' };
  if (value.whyNow.length > GOAL_LIMITS.whyNow) return { ok: false, problem: 'why-now-too-long' };
  return { ok: true, value };
}

/** The literal shape of a row in `goals`. Retired, never deleted; `retired_*` are stamped by the database. */
export interface GoalRow {
  id: string;
  org_id: string;
  model_id: string;
  title: string;
  /** What success looks like, in one or two plain sentences. */
  statement: string;
  /** Why now: a regulation, a merger, a contract ending. Empty when not given. */
  why_now: string;
  status: GoalStatus;
  created_by: string;
  created_at: string;
  retired_by: string | null;
  retired_at: string | null;
}

/** The literal shape of a row in `goal_capabilities` — primary key `(goal_id, capability_id)`. */
export interface GoalCapabilityRow {
  goal_id: string;
  /** An element id of type `capability` (no foreign key; checked by trigger). */
  capability_id: string;
  created_by: string;
  created_at: string;
}
