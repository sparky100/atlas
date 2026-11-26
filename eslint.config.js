// @ts-check
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import atlasRules from './eslint-rules/noBareSystemCheck.js';

export default defineConfig(
  {
    // `supabase/functions/**`: Deno edge functions (Sprint F7 item 1's
    // send-invite-email is the first) — a different runtime with its own
    // globals (`Deno`) and remote `https://esm.sh/...` imports this repo's
    // Node-based tsconfig/eslint project can't and shouldn't resolve.
    //
    // `public/downloads/**`: built by `pnpm mcp:bundle` (prebuild) and
    // gitignored — generated output, never hand-written source. `/*.mjs`:
    // loose root-level scripts (e.g. a local copy of the MuleSoft export
    // script from docs/import/mulesoft/) aren't part of the tsconfig
    // project; the tracked copy lives under docs/import and is ignored below.
    ignores: ['public/downloads/**', '*.mjs', 'dist/**', 'node_modules/**', 'supabase/.temp/**', 'supabase/functions/**', 'docs/import/**/*.mjs', 'coverage/**', 'storybook-static/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', 'eslint-rules/*.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md rule 6: no Math.random in anything deterministic. The engine,
      // contracts, and db layers must never touch it; a genuinely random UI
      // affordance (if one is ever needed) gets a narrow, file-scoped override
      // with a comment explaining why, not a project-wide allowance.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'No Math.random in deterministic code (CLAUDE.md). Ids, ordering, hashing and merge classification must be reproducible. Inject a seeded generator explicitly if randomness is genuinely needed.',
        },
      ],
      // CLAUDE.md rule 7: no demo shortcuts left behind as silent stubs.
      'no-warning-comments': [
        'error',
        { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'start' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.property.test.ts', '**/*.integration.test.ts'],
    rules: {
      // Property tests legitimately want loose-typed generators; keep the bar
      // at "no accidental any", not "no test ergonomics".
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  // src/ui only: React + accessibility rules. WCAG 2.2 AA is a stated
  // requirement (UI-principles.md §8.7), so jsx-a11y runs from the first
  // component, not bolted on once violations have accumulated.
  {
    files: ['src/ui/**/*.tsx', '.storybook/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['**/*.stories.tsx', '.storybook/**/*.ts', '.storybook/**/*.tsx'],
    rules: {
      // Story titles/args and Storybook's own config shape make several
      // strict-type-checked rules noisy for no real safety gain here.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  // CLAUDE.md §2 Language / S1 item 5: UI copy says change, live estate/
  // main, version, edit — never branch, head, commit, tag, delta, fold,
  // ref, RPC, SPEC, sprint. Scoped to what a user actually reads (JSX text
  // and the handful of attributes that render as visible/assistive text —
  // aria-label, title, placeholder, alt), not every string literal in
  // src/ui: a query key, a CSS class, an internal error-message argument
  // (`assertRealId('getBranch', ...)`) or a ref-kind literal (`'main'`)
  // is source code, not UI copy, and flagging those would just be noise
  // this rule was never meant to police. The versions page is the one
  // named exception (its own technical detail — ref/tag/commit vocabulary
  // is the page's actual subject, UI-principles §6.2/§6.3).
  {
    files: ['src/ui/**/*.tsx'],
    ignores: ['src/ui/versions/**/*.tsx', 'src/ui/routes/VersionsPage.tsx', 'src/ui/routes/VersionDiffPage.tsx', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/\\b(branch|branches|head|heads|commit|commits|tag|tags|delta|deltas|fold|folds|folding|ref|refs|rpc|spec|specs|sprint|sprints)\\b/i]',
          message:
            'CLAUDE.md §2 Language: UI copy uses change, live estate/main, version, edit — never branch, head, commit, tag, delta, fold, ref, RPC, SPEC, sprint (allow-listed for the versions page only).',
        },
        {
          selector:
            'JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > Literal[value=/\\b(branch|branches|head|heads|commit|commits|tag|tags|delta|deltas|fold|folds|folding|ref|refs|rpc|spec|specs|sprint|sprints)\\b/i]',
          message:
            'CLAUDE.md §2 Language: UI copy uses change, live estate/main, version, edit — never branch, head, commit, tag, delta, fold, ref, RPC, SPEC, sprint (allow-listed for the versions page only).',
        },
      ],
    },
  },
  // Model rule M2 (CLAUDE.md): a module is an element too. A bare check for the type 'system'
  // needs isSystemLike() or a 'system-only:' comment saying why. Sites that existed when the
  // rule was added are recorded in eslint-suppressions.json; only new ones fail.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.property.test.ts', '**/*.integration.test.ts', '**/*.stories.tsx'],
    plugins: { atlas: atlasRules },
    rules: { 'atlas/no-bare-system-check': 'error' },
  },
  {
    // This file itself: it's a *.js file, so parserOptions.projectService's
    // allowDefaultProject above gives it a synthetic, type-info-poor
    // program — eslint-plugin-jsx-a11y's exports resolve to `any` under
    // that program even though they're perfectly typed under the real
    // tsconfig. A tooling-config quirk, not a real type-safety gap.
    files: ['eslint.config.js', 'eslint-rules/*.js'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
