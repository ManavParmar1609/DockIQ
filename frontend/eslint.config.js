import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'src/api/schema.gen.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Every API call site must handle failure: no fire-and-forget promises.
      '@typescript-eslint/no-floating-promises': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Use the API client in src/api — it is the only gateway to the backend.',
        },
      ],
    },
  },
  {
    files: ['src/api/client.ts', 'src/test/**'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // These modules deliberately export a hook or helper beside their components; fast refresh
    // falls back to a full reload for them, which is fine.
    files: [
      'src/auth/AuthProvider.tsx',
      'src/components/Evidence.tsx',
      'src/components/Severity.tsx',
      'src/router.tsx',
      'src/shell/Alerts.tsx',
    ],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
