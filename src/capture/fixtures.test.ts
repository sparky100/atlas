/**
 * F2 (full K1) PR10, SPEC-capture.md §12.4: "the fixtures *are* the test" —
 * each of §12.2's fixtures is a real Vitest case here, gated into `pnpm test`
 * so a regression in any later PR that breaks 01-07 fails the ordinary
 * suite immediately. Runs `runCapture()` — the same function the edge
 * function will call (PR12) — against each fixture's own `RecordedLlmClient`
 * in replay mode, and scores the result against `expected.json` via the one
 * shared scorer (`fixtures/expectedOutcome.ts`) `scripts/scoreCapture.ts`
 * also calls, never a second oracle (§12.4's own rule).
 *
 * Sizes are deliberately smaller than §12.2's own illustrative row counts
 * (12, 18, 60, …) — every named messiness dimension is still exercised, but
 * at a size that stays hand-verifiable well under its own "10-40 rows"
 * allowance, which this harness's own author (not a live LLM) can actually
 * check by hand. Disclosed, not a demo shortcut: every fixture here is a
 * real input run through the real pipeline, scored against a real,
 * hand-verified expectation.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixture } from './fixtures/loadFixture';
import type { ExpectedOutcome } from './fixtures/expectedOutcome';
import { scoreFixture } from './fixtures/expectedOutcome';
import { runCapture } from './runCapture';

const FIXTURES_ROOT = join(__dirname, 'fixtures');

const FIXTURE_IDS = ['01-clean-register', '02-odd-headers', '03-roundtrip-export', '04-duplicates-within', '05-aliases-known', '06-containers-two-sheets', '07-merged-cells-and-junk'] as const;

function mintId(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-minted-${String(n++)}`;
}

describe.each(FIXTURE_IDS)('capture fixture %s', (id) => {
  it('matches its own expected.json (P-K1 replay gate)', async () => {
    const fixture = loadFixture(FIXTURES_ROOT, id);
    const expected = fixture.expectedRaw as ExpectedOutcome;

    const result = await runCapture({
      inputName: `${id}.${fixture.options.format}`,
      source: fixture.source,
      documentDate: fixture.options.documentDate,
      llmClient: fixture.llmClient,
      matchIndex: fixture.matchIndex,
      mainHead: fixture.head,
      ...(fixture.reimportPrevious ? { reimportPrevious: fixture.reimportPrevious } : {}),
      mintId: mintId(id),
    });

    const score = scoreFixture(id, result, expected, fixture.keyToId);
    expect(score.failures, score.failures.join('\n')).toEqual([]);
    expect(score.pass).toBe(true);
  });

  it('is deterministic — same bytes, same model, same cassette yields the same candidate set modulo minted ids (P-K1)', async () => {
    const fixture = loadFixture(FIXTURES_ROOT, id);
    const runOnce = () =>
      runCapture({
        inputName: `${id}.${fixture.options.format}`,
        source: fixture.source,
        documentDate: fixture.options.documentDate,
        llmClient: fixture.llmClient,
        matchIndex: fixture.matchIndex,
        mainHead: fixture.head,
        ...(fixture.reimportPrevious ? { reimportPrevious: fixture.reimportPrevious } : {}),
        mintId: mintId(id),
      });

    const [a, b] = await Promise.all([runOnce(), runOnce()]);
    if (a.status !== 'parsed' || b.status !== 'parsed') {
      expect(a.status).toBe(b.status);
      return;
    }
    const mask = (r: typeof a) => r.candidates.map((c) => ({ ...c, draftSubjectId: c.draftSubjectId === null ? null : '<masked>' }));
    expect(mask(a)).toEqual(mask(b));
    expect(a.stats).toEqual(b.stats);
  });
});
