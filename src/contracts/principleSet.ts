/**
 * Wire and storage contract for a published set of principles
 * (`supabase/migrations/20261117300000_principle_sets.sql`, ADR-034 "Starter
 * sets"). Types and one parser: no I/O, no engine logic.
 *
 * A set's `payload` holds only the wording of each principle — the same three
 * fields a person types on the Principles page. It names no organisation,
 * model or person.
 */
import { z } from 'zod';
import { PRINCIPLE_LIMITS, type PrincipleInput } from './principles';

/** Slug rule the table enforces (`principle_sets.slug`). */
export const PRINCIPLE_SET_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const PRINCIPLE_SET_LIMITS = { slug: 60, name: 120, description: 500, principles: 50 } as const;

export interface PrincipleSetPayload {
  principles: PrincipleInput[];
}

/** One published version of a set, as the list reads it (no payload). */
export interface PrincipleSetSummary {
  id: string;
  slug: string;
  version: number;
  name: string;
  description: string | null;
}

const principleSetPayloadSchema = z.object({
  principles: z
    .array(
      z.object({
        title: z.string().min(1).max(PRINCIPLE_LIMITS.title),
        statement: z.string().min(1).max(PRINCIPLE_LIMITS.statement),
        why: z.string().max(PRINCIPLE_LIMITS.why),
      }),
    )
    .min(1)
    .max(PRINCIPLE_SET_LIMITS.principles),
});

/** Parses a stored payload, throwing a plain error if it is not the shape the table promises. */
export function parsePrincipleSetPayload(value: unknown): PrincipleSetPayload {
  const parsed = principleSetPayloadSchema.safeParse(value);
  if (!parsed.success) throw new Error('parsePrincipleSetPayload: the stored set is not in the expected shape');
  return parsed.data;
}
