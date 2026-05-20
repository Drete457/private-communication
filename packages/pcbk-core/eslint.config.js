import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import promisePlugin from 'eslint-plugin-promise';
import securityPlugin from 'eslint-plugin-security';

const tsFiles = ['src/**/*.ts', 'test/**/*.ts'];
const sourceFiles = ['src/**/*.ts'];

const withTypeChecking = (configs) => configs.map((config) => ({
  ...config,
  files: tsFiles,
  languageOptions: {
    ...(config.languageOptions || {}),
    parserOptions: {
      ...(config.languageOptions?.parserOptions || {}),
      project: ['./tsconfig.eslint.json'],
      tsconfigRootDir: import.meta.dirname
    }
  }
}));

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.js']
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error'
    }
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
    ...promisePlugin.configs['flat/recommended'],
    files: tsFiles
  },
  {
    files: tsFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.es2022
      }
    },
    plugins: {
      security: securityPlugin
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.eslint.json'
        }
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
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
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
        'newlines-between': 'always'
      }],
      indent: ['error', 'tab', { SwitchCase: 1 }],
      'no-alert': 'error',
      'no-console': 'error',
      // Deliberate passphrase policy: reject ASCII control characters.
      'no-control-regex': 'off',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-implicit-coercion': 'error',
      'no-return-await': 'off',
      'no-tabs': 'off',
      'no-undef': 'off',
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
    files: sourceFiles,
    rules: {
      'import/no-nodejs-modules': 'error',
      'no-restricted-globals': ['error',
        { name: 'window', message: 'PCBK core must stay browser-agnostic.' },
        { name: 'document', message: 'PCBK core must not depend on DOM APIs.' },
        { name: 'navigator', message: 'PCBK core must not depend on browser app state.' },
        { name: 'localStorage', message: 'PCBK core must not persist app data.' },
        { name: 'sessionStorage', message: 'PCBK core must not persist app data.' },
        { name: 'indexedDB', message: 'PCBK core must not own browser storage integration.' },
        { name: 'caches', message: 'PCBK core must not depend on service worker caches.' }
      ],
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: 'React belongs in the frontend package.' },
          { name: 'react-dom', message: 'React belongs in the frontend package.' },
          { name: 'dexie', message: 'Dexie integration belongs in the frontend package.' },
          { name: 'zustand', message: 'Zustand state belongs in the frontend package.' }
        ],
        patterns: [
          { group: ['@/*', '@components/*', '@services/*', '@crypto/*', '@store/*', '@views/*'], message: 'PCBK core must not import app-layer aliases.' }
        ]
      }],
      'no-restricted-properties': ['error',
        { object: 'globalThis', property: 'window', message: 'PCBK core must stay browser-agnostic.' },
        { object: 'globalThis', property: 'document', message: 'PCBK core must not depend on DOM APIs.' },
        { object: 'globalThis', property: 'localStorage', message: 'PCBK core must not persist app data.' },
        { object: 'globalThis', property: 'sessionStorage', message: 'PCBK core must not persist app data.' },
        { object: 'globalThis', property: 'indexedDB', message: 'PCBK core must not own browser storage integration.' }
      ]
    }
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.node
      }
    },
    rules: {
      'import/no-nodejs-modules': 'off'
    }
  }
];