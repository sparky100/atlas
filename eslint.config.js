// @ts-check
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**', 'supabase/.temp/**', 'coverage/**', 'storybook-static/**'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js'],
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
  {
    // This file itself: it's a *.js file, so parserOptions.projectService's
    // allowDefaultProject above gives it a synthetic, type-info-poor
    // program — eslint-plugin-jsx-a11y's exports resolve to `any` under
    // that program even though they're perfectly typed under the real
    // tsconfig. A tooling-config quirk, not a real type-safety gap.
    files: ['eslint.config.js'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
