import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Words from the engine/data model that must not appear in text a user reads (Simon, 2026-11-08: consistent plain English throughout). Checked against JSX text between tags only, so identifiers, data values and comments are untouched. */
const BANNED = [/\bmerge requests?\b/i, /\bretracted\b/i, /\bretraction\b/i, /\bdeltas?\b/i, /\bsupports edges?\b/i, /\bcommits? since\b/i];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') && !path.endsWith('.stories.tsx') ? [path] : [];
  });
}

describe('plain-English UI text', () => {
  it('has no engine words in JSX text', () => {
    const offences: string[] = [];
    for (const file of tsxFiles(join(__dirname))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/>([^<>{}=;()]+)</g)) {
        const text = match[1] ?? '';
        const banned = BANNED.find((re) => re.test(text));
        if (banned) offences.push(`${file}: "${text.trim()}"`);
      }
    }
    expect(offences).toEqual([]);
  });
});
