/**
 * Wire and storage contract for a published sample model
 * (`supabase/migrations/20261115120000_sample_models.sql`, docs/ADR-033).
 * Types and one parser: no I/O, no engine logic.
 *
 * A sample's `payload` is the head of one model plus the sources and aliases
 * its facts name, in the same row shapes the database stores. It holds no
 * person's id and no link out: see `src/engine/sampleModel.ts`'s builder.
 */
import { z } from 'zod';
import type { UUID } from './delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from './rows';
import { SOURCE_KINDS, type SourceKind } from './sources';

/** A source a sample fact names — only what a copy needs, never a person or a capture job. */
export interface SampleSource {
  id: UUID;
  kind: SourceKind;
  name: string;
  /** Always null in a published sample: a link out can name a private document. */
  uri: string | null;
  captured_at: string | null;
  /** Set only for a `template` source, which names public product content (a capability map). */
  capability_map_id: UUID | null;
}

export type SampleAliasType = 'name' | 'code' | 'external_ref' | 'source_system_key' | 'template_code';

export interface SampleAlias {
  element_id: UUID;
  alias_value: string;
  alias_type: SampleAliasType;
  source_id: UUID;
  confidence: number;
}

export interface SamplePayload {
  elementsHead: ElementsHeadRow[];
  relationshipsHead: RelationshipsHeadRow[];
  facts: FactsRow[];
  sources: SampleSource[];
  aliases: SampleAlias[];
}

/** One published version of a sample, as the model list reads it (no payload). */
export interface SampleModelSummary {
  id: UUID;
  slug: string;
  version: number;
  name: string;
  description: string | null;
}

/** Slug rule the table enforces (`sample_models.slug`). */
export const SAMPLE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const uuid = z.string().min(1);
const rowArray = z.array(z.record(z.string(), z.unknown()));

const samplePayloadSchema = z.object({
  elementsHead: rowArray,
  relationshipsHead: rowArray,
  facts: rowArray,
  sources: z.array(
    z.object({
      id: uuid,
      kind: z.enum(SOURCE_KINDS),
      name: z.string().min(1),
      uri: z.string().nullable(),
      captured_at: z.string().nullable(),
      capability_map_id: z.string().nullable(),
    }),
  ),
  aliases: z.array(
    z.object({
      element_id: uuid,
      alias_value: z.string().min(1),
      alias_type: z.enum(['name', 'code', 'external_ref', 'source_system_key', 'template_code']),
      source_id: uuid,
      confidence: z.number().min(0).max(1),
    }),
  ),
});

/** Parses a stored payload, naming the first thing wrong. The row arrays are checked by the database and the engine's own fold; this checks the shape a copy relies on. */
export function parseSamplePayload(value: unknown): SamplePayload {
  const parsed = samplePayloadSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`parseSamplePayload: ${first ? `${first.path.join('.')}: ${first.message}` : 'invalid payload'}`);
  }
  return parsed.data as unknown as SamplePayload;
}
