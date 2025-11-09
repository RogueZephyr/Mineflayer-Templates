import js from '@eslint/js';
import pluginImport from 'eslint-plugin-import';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2021
      }
    },
    plugins: {
      import: pluginImport
    },
    rules: {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all', caughtErrorsIgnorePattern: '^_' }],
      'no-console': 'off',
      'import/no-unresolved': 'off',
      // Allow empty catch blocks (we intentionally swallow errors in some places)
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Disable case declaration restriction to avoid refactors for now
      'no-case-declarations': 'off'
    },
    ignores: ['node_modules/**', 'dist/**']
  }
];
