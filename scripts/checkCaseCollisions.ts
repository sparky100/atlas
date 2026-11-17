/**
 * Fails if any two tracked paths differ only by case — e.g.
 * `ElementTypeGlyph.tsx` and `elementTypeGlyph.ts` sitting in the same
 * directory. Git itself (and Linux CI) is case-sensitive and sees these as
 * distinct files, but the default filesystem on Windows and on stock macOS
 * is not: an extension-less import resolves whichever candidate the OS
 * happens to return first, silently picking the wrong file depending on
 * developer's machine. See src/ui/components/ElementTypeGlyph's
 * `glyph.ts` (originally `elementTypeGlyph.ts`) for the bug this guards
 * against — `pnpm build` failed only on Windows, never in CI.
 *
 * Equivalent to: git ls-files | tr 'A-Z' 'a-z' | sort | uniq -d
 * (reimplemented in Node so it runs the same way in CI and in `pnpm run`
 * on every platform, without relying on a POSIX shell pipeline).
 *
 * Run with `pnpm check:case-collisions`.
 */
import { execFileSync } from 'node:child_process';

const output = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
const paths = output.split('\n').filter(Boolean);

const byLowercase = new Map<string, string[]>();
for (const path of paths) {
  // Also drop the extension: `Foo.tsx` and `foo.ts` are different files to git,
  // but an extension-less import (`./Foo`) resolves to `foo.ts` on Windows/macOS.
  const key = path.toLowerCase().replace(/\.(d\.ts|tsx?|jsx?|mjs|cjs)$/, '');
  const bucket = byLowercase.get(key);
  if (bucket) {
    bucket.push(path);
  } else {
    byLowercase.set(key, [path]);
  }
}

const collisions = [...byLowercase.values()].filter((group) => group.length > 1);

if (collisions.length > 0) {
  console.error('Found tracked paths that differ only by case:\n');
  for (const group of collisions) {
    console.error(`  ${group.join('\n  ')}`);
  }
  console.error(
    '\nThese resolve to the same file on case-insensitive filesystems (default on Windows and macOS) ' +
      'and can silently pick the wrong file. Rename so no two paths differ only by case.',
  );
  process.exit(1);
}

console.log('No case-only path collisions found.');
