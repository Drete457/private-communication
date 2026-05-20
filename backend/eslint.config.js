const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');
const importPlugin = require('eslint-plugin-import');
const nodePluginModule = require('eslint-plugin-n');
const promisePlugin = require('eslint-plugin-promise');
const securityPlugin = require('eslint-plugin-security');

const nodePlugin = nodePluginModule.default ?? nodePluginModule;

const tsFiles = ['src/**/*.ts'];

const withTypeChecking = (configs) => configs.map((config) => ({
  ...config,
  files: tsFiles,
  languageOptions: {
    ...(config.languageOptions || {}),
    parserOptions: {
      ...(config.languageOptions?.parserOptions || {}),
      project: ['./tsconfig.json'],
      tsconfigRootDir: __dirname
    }
  }
}));

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.js']
  },
  {
    ...js.configs.recommended,
    files: tsFiles
  },
  ...withTypeChecking(tseslint.configs.strictTypeChecked),
  ...withTypeChecking(tseslint.configs.stylisticTypeChecked),
  {
    ...importPlugin.flatConfigs.recommended,
    files: tsFiles
  },
  {
    ...importPlugin.flatConfigs.typescript,
    files: tsFiles
  },
  {
    ...nodePlugin.configs['flat/recommended-module'],
    files: tsFiles
  },
  {
    ...promisePlugin.configs['flat/recommended'],
    files: tsFiles
  },
  {
    files: tsFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.es2024,
        ...globals.nodeBuiltin
      }
    },
    plugins: {
      security: securityPlugin
    },
    settings: {
      node: {
        version: '>=24.0.0',
        tryExtensions: ['.ts', '.js', '.json']
      },
      'import/resolver': {
        typescript: {
          project: './tsconfig.json'
        },
        node: true
      }
    },
    rules: {
      '@typescript-eslint/array-type': ['error', { default: 'array-simple', readonly: 'generic' }],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', {
        disallowTypeAnnotations: false,
        fixStyle: 'separate-type-imports',
        prefer: 'type-imports'
      }],
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-confusing-void-expression': ['error', {
        ignoreArrowShorthand: true,
        ignoreVoidOperator: true
      }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: true
      }],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', {
        allowAny: false,
        allowBoolean: false,
        allowNever: false,
        allowNullish: false,
        allowNumber: true,
        allowRegExp: false
      }],
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/no-cycle': ['error', { ignoreExternal: true, maxDepth: 1 }],
      'import/no-duplicates': 'error',
      'import/no-mutable-exports': 'error',
      'import/no-named-as-default': 'off',
      'import/no-unresolved': ['error', { caseSensitive: true, commonjs: false }],
      'import/order': ['error', {
        alphabetize: { caseInsensitive: true, order: 'asc' },
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
        pathGroups: [
          { group: 'internal', pattern: '@/**', position: 'after' }
        ],
        pathGroupsExcludedImportTypes: ['builtin'],
        'newlines-between': 'always'
      }],
      'n/no-missing-import': 'off',
      'n/no-process-exit': 'error',
      'n/no-unsupported-features/es-syntax': 'off',
      'n/prefer-global/buffer': ['error', 'always'],
      'n/prefer-global/process': ['error', 'always'],
      'no-console': 'error',
      'no-control-regex': 'off',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-implicit-coercion': 'error',
      'no-restricted-syntax': ['error', {
        selector: 'CallExpression[callee.object.name="console"]',
        message: 'Use the shared logger and never print backend secrets to stdout.'
      }],
      'no-return-await': 'off',
      'no-useless-catch': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-const': ['error', { destructuring: 'all' }],
      'prefer-template': 'error',
      'promise/always-return': 'off',
      'promise/catch-or-return': ['error', { allowFinally: true }],
      'promise/no-nesting': 'error',
      'security/detect-bidi-characters': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'error',
      'security/detect-non-literal-regexp': 'error',
      'security/detect-non-literal-require': 'error',
      'security/detect-object-injection': 'error',
      'security/detect-possible-timing-attacks': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-unsafe-regex': 'error'
    }
  },
  {
    files: ['src/utils/logger.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off'
    }
  }
];