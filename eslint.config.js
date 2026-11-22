import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import ts from 'typescript-eslint';

// Unit tests and their helpers, and the end-to-end suite.
const tests = ['**/*.test.ts', '**/fake-*.ts', 'src/core/fixtures/**', 'e2e/**'];

export default defineConfig(
  globalIgnores(['.output/', '.wxt/', 'node_modules/', 'test-results/', 'store/']),

  js.configs.recommended,
  ts.configs.recommendedTypeChecked,
  vue.configs['flat/recommended'],

  {
    languageOptions: {
      parserOptions: {
        // vue-eslint-parser hands <script lang="ts"> to the TypeScript parser.
        parser: ts.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // A promise nobody awaits is how a storage write or a proxy change gets
      // lost. Say `void` when that is the intent.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
    },
  },

  // The extension itself runs in a browser.
  {
    files: ['src/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },

  // Tests, the e2e suite, and build scripts run under Bun.
  {
    files: [...tests, 'scripts/**', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  // Tests reach into fakes and loosely typed browser objects on purpose.
  {
    files: tests,
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // A fake of an async browser API is async with nothing to await.
      '@typescript-eslint/require-await': 'off',
      // bun:test types `expect(...).resolves` as void; it returns a promise.
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Plain JavaScript config files have no type information.
  { files: ['**/*.js'], extends: [ts.configs.disableTypeChecked] },

  // Formatting belongs to Prettier.
  prettier,
);
