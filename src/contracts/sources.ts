/**
 * The `source_kind` enum (SPEC §3.6, `supabase/migrations/..._enums.sql`).
 * Wire/storage contract only — the source-kind glyph mapping used to render
 * a provenance badge (UI-principles.md §4.3) is a presentation concern and
 * lives in `src/ui`, not here.
 */
export const SOURCE_KINDS = ['document', 'spreadsheet', 'interview', 'capture_job', 'template', 'manual', 'merge_resolution', 'attestation'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
