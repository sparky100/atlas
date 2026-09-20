/**
 * F2 (full K1), SPEC-capture.md §6.4: "Prompts are versioned: `PROMPT_VERSION`
 * ... is recorded in `capture_jobs.llm_usage.promptVersion` and in every
 * fixture cassette's key. Changing a prompt invalidates the cassettes, which
 * is the point." Bump this whenever any frozen system prompt or schema in
 * `a.ts`/`b.ts`/`c.ts` changes — never silently, and never without
 * re-running `pnpm capture:score --live` and re-committing its cassettes
 * (§12.6).
 */
export const PROMPT_VERSION = '2026-09-20.1';

export * from './a';
export * from './b';
export * from './c';
