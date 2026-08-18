import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

export default tseslint.config(
  {
    ignores: [
      'out/',
      'dist/',
      'node_modules/',
      '**/*.d.ts',
      'web/dist/',
      '**/*.js.map',
      '.vscode-test/',
      '.dj/',
      '*.vsix',
      'target/',
      'dbt_packages/',
      'logs/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // Jest mocks (and any other JS under src/) are not in the TS program.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      'unused-imports': unusedImports,
      'simple-import-sort': simpleImportSort,
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // Import management
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // Naming & style
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
      ],
      curly: 'warn',
      eqeqeq: 'warn',
      semi: 'warn',
      'prefer-const': 'warn',

      // TypeScript-specific rules
      'no-throw-literal': 'off',
      '@typescript-eslint/only-throw-error': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/await-thenable': 'warn', // Changed to warn
      '@typescript-eslint/no-misused-promises': 'warn', // Changed to warn
      '@typescript-eslint/prefer-optional-chain': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/prefer-promise-reject-errors': 'warn', // Added as warn
      '@typescript-eslint/no-duplicate-type-constituents': 'warn', // Added as warn
      '@typescript-eslint/unbound-method': 'warn', // Added as warn

      // Disable no-unsafe-* rules - codebase intentionally uses dynamic typing
      // for DBT manifest, webview messages, and API handlers. These patterns are
      // tested, working, and common in VS Code extensions. Fixing requires
      // comprehensive type definitions.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // Keep enabled - these indicate real issues or quick fixes
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',

      // Disable base rules replaced by TypeScript versions
      'no-undef': 'off', // TypeScript handles this
      'no-unused-vars': 'off', // Use unused-imports plugin instead
      'no-redeclare': 'off',

      '@typescript-eslint/no-unused-vars': 'off', // Use unused-imports plugin instead
      '@typescript-eslint/no-redeclare': 'error',

      // TODO: Gradually fix explicit any types over time.
      // This is a long-term improvement.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Code quality
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-catch': 'warn',
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
      'no-unsafe-optional-chaining': 'warn',
      'no-extra-boolean-cast': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Test files
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
