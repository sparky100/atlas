// @ts-check
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**', 'supabase/.temp/**', 'coverage/**'],
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
);
