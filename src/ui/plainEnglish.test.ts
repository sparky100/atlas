import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Words from the engine/data model that must not appear in text a user reads (Simon, 2026-11-08: consistent plain English throughout). Checked against JSX text between tags only, so identifiers, data values and comments are untouched. */
const BANNED = [/\barchimate\b/i, /\btogaf\b/i, /\bmerge requests?\b/i, /\bretracted\b/i, /\bretraction\b/i, /\bdeltas?\b/i, /\bsupports edges?\b/i, /\bcommits? since\b/i];

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

/** Pages that open with something other than a one-line summary: detail pages (they open with the thing itself), canvas pages (the picture needs the room), sign-in pages, and pages that already carry their own intro text. Every other page that has a title must say in one plain sentence what it shows. */
const NO_INTRO_NEEDED = new Set([
  'AskAtlasPage.tsx',
  'CapabilityMapPage.tsx',
  'CaptureReviewPage.tsx',
  'ContainerPage.tsx',
  'ContextPage.tsx',
  'DashboardPage.tsx',
  'DecisionOptionLandscapePage.tsx',
  'DecisionPage.tsx',
  'GapsPage.tsx',
  'Home.tsx',
  'LandscapePage.tsx',
  'ModelHome.tsx',
  'ModelRouteGate.tsx',
  'OrgHome.tsx',
  'PlatformAdminPage.tsx',
  'ProfilePage.tsx',
  'ProjectPage.tsx',
  'ReportsPage.tsx',
  'ResetPasswordPage.tsx',
  'ReviewRequestPage.tsx',
  'SavedReportPage.tsx',
  'SignIn.tsx',
  'VersionDiffPage.tsx',
]);

describe('page summaries', () => {
  it('gives every list and settings page a one-line summary under its title', () => {
    const routesDir = join(__dirname, 'routes');
    const missing = readdirSync(routesDir)
      .filter((name) => name.endsWith('.tsx') && !NO_INTRO_NEEDED.has(name))
      .filter((name) => {
        const source = readFileSync(join(routesDir, name), 'utf8');
        return source.includes('as="h1"') && !source.includes('<PageIntro>');
      });
    expect(missing).toEqual([]);
  });
});
