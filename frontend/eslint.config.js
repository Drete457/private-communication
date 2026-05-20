import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importPlugin from 'eslint-plugin-import';
import promisePlugin from 'eslint-plugin-promise';

const tsFiles = ['**/*.{ts,tsx}'];
const sourceFiles = ['src/**/*.{ts,tsx}'];
const reactFiles = ['src/**/*.{tsx,ts}'];
const configFiles = ['vite.config.ts'];

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
    ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.js']
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
    files: sourceFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.es2024,
        ...globals.browser
      }
    }
  },
  {
    files: ['src/sw.ts'],
    languageOptions: {
      globals: {
        ...globals.serviceworker
      }
    }
  },
  {
    files: ['test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.es2024,
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    files: configFiles,
    languageOptions: {
      globals: {
        ...globals.es2024,
        ...globals.node
      }
    },
    rules: {
      'import/no-nodejs-modules': 'off'
    }
  },
  {
    files: reactFiles,
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactPlugin.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.flat['recommended-latest'].rules,
      ...jsxA11y.flatConfigs.strict.rules,
      'jsx-a11y/label-has-associated-control': ['error', {
        assert: 'either',
        controlComponents: ['Input', 'Select', 'TextArea']
      }],
      'jsx-a11y/media-has-caption': 'off',
      'jsx-a11y/no-autofocus': ['error', { ignoreNonDOM: true }],
      'react/boolean-prop-naming': 'off',
      'react/function-component-definition': ['error', {
        namedComponents: 'arrow-function',
        unnamedComponents: 'arrow-function'
      }],
      'react/jsx-boolean-value': ['error', 'never'],
      'react/jsx-curly-brace-presence': ['error', {
        children: 'never',
        propElementValues: 'always',
        props: 'never'
      }],
      'react/jsx-fragments': ['error', 'syntax'],
      'react/jsx-no-leaked-render': ['error', { validStrategies: ['coerce', 'ternary'] }],
      'react/jsx-no-useless-fragment': 'error',
      'react/no-array-index-key': 'off',
      'react/no-unstable-nested-components': ['error', { allowAsProps: true }],
      'react/prop-types': 'off',
      'react/require-default-props': 'off',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'error',
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }]
    }
  },
  {
    files: tsFiles,
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
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
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-confusing-void-expression': ['error', {
        ignoreArrowShorthand: true,
        ignoreVoidOperator: true
      }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: {
          attributes: true,
          inheritedMethods: true,
          properties: true,
          returns: true,
          variables: true
        }
      }],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', {
        allowAny: false,
        allowBoolean: false,
        allowNever: false,
        allowNullish: false,
        allowNumber: true,
        allowRegExp: false
      }],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
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
      'import/no-nodejs-modules': 'error',
      'import/no-unresolved': ['error', { caseSensitive: true, commonjs: false, ignore: ['^virtual:pwa-register$'] }],
      'import/order': ['error', {
        alphabetize: { caseInsensitive: true, order: 'asc' },
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
        pathGroups: [
          { group: 'internal', pattern: '@/**', position: 'after' },
          { group: 'internal', pattern: '@components/**', position: 'after' },
          { group: 'internal', pattern: '@services/**', position: 'after' },
          { group: 'internal', pattern: '@crypto/**', position: 'after' },
          { group: 'internal', pattern: '@store/**', position: 'after' },
          { group: 'internal', pattern: '@types/**', position: 'after' },
          { group: 'internal', pattern: '@hooks/**', position: 'after' },
          { group: 'internal', pattern: '@views/**', position: 'after' }
    ],
    pathGroupsExcludedImportTypes: ['builtin'],
    'newlines-between': 'always'
    }],
    indent: ['error', 'tab', { SwitchCase: 1 }],
    'no-alert': 'error',
    'no-console': 'error',
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
      'promise/no-nesting': 'error'
    }
  },
  {
    files: ['src/components/backup/backup-settings.tsx'],
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
      'no-alert': 'off'
    }
  },
  {
    files: ['src/components/layout/layout.tsx'],
    rules: {
      '@typescript-eslint/no-deprecated': 'off'
    }
  },
  {
    files: ['src/services/logger.ts'],
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/require-await': 'off',
      'import/first': 'off',
      'import/order': 'off'
    }
  },
  {
    files: configFiles,
    rules: {
      'import/no-nodejs-modules': 'off',
      indent: ['error', 2, { SwitchCase: 1 }]
    }
  }
];