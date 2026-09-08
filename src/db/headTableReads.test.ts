import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Enforces SPEC §6.7's pagination rule (Sprint C1-H item 1d): every
 * multi-row read against `elements_head`/`relationships_head`/`facts`/
 * `deltas`/`commits` — the tables `supabase/config.toml`'s `max_rows` (1000)
 * can silently truncate — must go through `selectAll` (src/db/selectAll.ts),
 * not a bare `.select(...)`. A single-row lookup by a unique key
 * (`.maybeSingle()`/`.single()`) is exempt: it can never return more than
 * one row, so `max_rows` can't truncate it.
 *
 * This is a text-level scan of src/db's own source, not a type-aware one —
 * matching the same grep-shaped enforcement style as
 * scripts/checkCaseCollisions.ts. It knows two shapes: `selectAll(...)`
 * wrapped directly around a `.from('TABLE')` chain in the same statement,
 * and a query built into a `const NAME = supabase.from('TABLE')...` that's
 * passed to `selectAll(...)` (by that same name) later in the file — both
 * patterns every real call site in this module uses. A read shaped some
 * third way would slip past this test undetected; if you're adding one,
 * make sure it's actually paginated, not just written to dodge the check.
 *
 * Two more shapes are exempt for the same reason `.maybeSingle()`/
 * `.single()` are — `max_rows` truncation genuinely cannot happen to
 * them, not because they dodge the letter of the rule: `head: true`
 * (Sprint U3b, src/db/modelHome.ts's counts — a count-only query returns
 * zero data rows regardless, only the exact count Postgres computed) and
 * `.limit(N)` for a literal, caller-fixed `N` (Sprint U3b's
 * `listRecentCommits` — the query already asks for fewer rows than
 * `max_rows` could ever truncate down to).
 */

const GUARDED_TABLES = ['elements_head', 'relationships_head', 'facts', 'deltas', 'commits'] as const;

const DB_DIR = join(__dirname);

function readSourceFiles(): { file: string; text: string }[] {
  return readdirSync(DB_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ file: name, text: readFileSync(join(DB_DIR, name), 'utf8') }));
}

/** From a `.from('TABLE')` match's index, the rest of that statement — up to (and including) the next top-level `;`. Good enough for this codebase's single-expression query chains. */
function statementFrom(text: string, fromIndex: number): string {
  const semi = text.indexOf(';', fromIndex);
  return semi === -1 ? text.slice(fromIndex) : text.slice(fromIndex, semi + 1);
}

/** Everything since the previous statement's `;` (or the start of the file), up to `toIndex` — the current statement's own prefix, to check for `const NAME = supabase`. */
function statementPrefixBefore(text: string, toIndex: number): string {
  const semi = text.lastIndexOf(';', toIndex - 1);
  return text.slice(semi + 1, toIndex);
}

interface Violation {
  file: string;
  table: string;
  snippet: string;
}

function findViolationsIn(sources: { file: string; text: string }[]): Violation[] {
  const violations: Violation[] = [];

  for (const { file, text } of sources) {
    for (const table of GUARDED_TABLES) {
      const fromPattern = new RegExp(`\\.from\\('${table}'\\)`, 'g');
      let match: RegExpExecArray | null;
      while ((match = fromPattern.exec(text))) {
        const stmt = statementFrom(text, match.index);
        const prefix = statementPrefixBefore(text, match.index);

        // Exempt: a single-row lookup by a unique key can't be truncated by max_rows.
        if (/\.maybeSingle\(|\.single\(/.test(stmt)) continue;

        // Exempt: a count-only query (no data rows returned at all) or a
        // literal `.limit(N)` already below max_rows — see this file's own
        // module comment.
        if (/head:\s*true/.test(stmt) || stmt.includes('.limit(')) continue;

        // Directly wrapped, in either order within the same statement:
        // `selectAll(supabase.from(...)...)` (selectAll precedes the match)
        // or (defensively) `supabase.from(...)....` followed by a `selectAll`
        // call closing over it later in the same statement.
        if (/\bselectAll\b/.test(prefix) || /\bselectAll\b/.test(stmt)) continue;

        // Built into a named variable, passed to selectAll elsewhere in the file:
        // `const NAME = supabase.from(...)...;` ... `selectAll<T>(NAME)`.
        const assignedTo = /const\s+(\w+)\s*=\s*supabase\s*$/.exec(prefix);
        const varName = assignedTo?.[1];
        if (varName && new RegExp(`selectAll(?:<[^>]*>)?\\(\\s*${varName}\\s*[,)]`).test(text)) continue;

        violations.push({ file, table, snippet: stmt.slice(0, 160).replace(/\s+/g, ' ') });
      }
    }
  }

  return violations;
}

describe('head-scoped table reads (SPEC §6.7)', () => {
  it('routes every elements_head/relationships_head/facts/deltas/commits read through selectAll', () => {
    const violations = findViolationsIn(readSourceFiles());
    if (violations.length > 0) {
      const message = violations.map((v) => `  ${v.file} (${v.table}): ${v.snippet}`).join('\n');
      expect.fail(
        `Found ${String(violations.length)} unpaginated read(s) against a table max_rows can silently truncate. Route through selectAll (src/db/selectAll.ts), or add .maybeSingle()/.single() if it's genuinely a single-row lookup:\n${message}`,
      );
    }
  });

  // Tests the checker itself: it must not just always pass. Each case below
  // is a synthetic file, not real repo source.
  describe('the checker itself', () => {
    it('flags a bare unpaginated select against a guarded table', () => {
      const violations = findViolationsIn([{ file: 'fixture.ts', text: `supabase.from('elements_head').select('*').eq('commit_id', commitId);` }]);
      expect(violations).toHaveLength(1);
    });

    it('does not flag a read wrapped directly in selectAll(...)', () => {
      const violations = findViolationsIn([{ file: 'fixture.ts', text: `selectAll<Row>(supabase.from('elements_head').select('*', { count: 'exact' }).eq('commit_id', commitId));` }]);
      expect(violations).toHaveLength(0);
    });

    it('does not flag a query built into a variable and passed to selectAll later', () => {
      const violations = findViolationsIn([
        { file: 'fixture.ts', text: `const query = supabase.from('commits').select('*', { count: 'exact' }).eq('model_id', modelId);\nconst rows = await selectAll<Row>(query);` },
      ]);
      expect(violations).toHaveLength(0);
    });

    it('does not flag a single-row lookup (.maybeSingle/.single)', () => {
      const violations = findViolationsIn([{ file: 'fixture.ts', text: `supabase.from('deltas').select('*').eq('id', deltaId).maybeSingle();` }]);
      expect(violations).toHaveLength(0);
    });

    it('does not flag a read against an unguarded table', () => {
      const violations = findViolationsIn([{ file: 'fixture.ts', text: `supabase.from('branches').select('*').eq('model_id', modelId);` }]);
      expect(violations).toHaveLength(0);
    });

    it('does not flag a count-only query (head: true)', () => {
      const violations = findViolationsIn([{ file: 'fixture.ts', text: `supabase.from('elements_head').select('element_id', { count: 'exact', head: true }).eq('commit_id', commitId);` }]);
      expect(violations).toHaveLength(0);
    });

    it('does not flag a literal .limit(N)', () => {
      const violations = findViolationsIn([{ file: 'fixture.ts', text: `supabase.from('commits').select('*').eq('branch_id', branchId).order('created_at', { ascending: false }).limit(10);` }]);
      expect(violations).toHaveLength(0);
    });
  });
});
