const globals = require('globals');
const js = require('@eslint/js');
const jsdoc = require('eslint-plugin-jsdoc');

const importPlugin = require('eslint-plugin-import');
const spellcheck = require('eslint-plugin-spellcheck');
const unicorn = require('eslint-plugin-unicorn');
const writeGoodComments = require('eslint-plugin-write-good-comments');

module.exports = [
	{
		ignores: ['**/node_modules'],
	},
	js.configs.recommended,
	jsdoc.configs['flat/recommended'],
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: globals.builtin,
		},
	},
	{
		files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
		plugins: {
			import: importPlugin,
			'write-good-comments': writeGoodComments,
			spellcheck,
			unicorn,
		},
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				Bun: false,
			},
		},
		rules: {
			'no-console': 'warn',
			'no-nested-ternary': 'error',
			'no-var': 'error',
			'prefer-const': 'error',
			'no-async-promise-executor': 'off',
			'no-prototype-builtins': 'off',

			'unicorn/filename-case': 'off',
			'unicorn/no-null': 'off',
			'unicorn/no-await-expression-member': 'off',
			'unicorn/no-array-for-each': 'off',
			'unicorn/prefer-spread': 'off',
			'unicorn/no-negated-condition': 'off',
			'unicorn/no-array-reduce': 'off',
			'unicorn/no-array-callback-reference': 'off',
			'unicorn/prefer-query-selector': 'off',
			'unicorn/no-this-assignment': 'off',
			'unicorn/consistent-function-scoping': 'off',
			'unicorn/numeric-separators-style': 'off',
			'unicorn/prefer-switch': 'off',
			'unicorn/prefer-global-this': 'off',
			'unicorn/import-style': 'off',

			'import/no-unresolved': [1, { ignore: ['bun', 'bun:test'] }],
			'import/no-useless-path-segments': 'error',
			'import/first': 'warn',
			'import/order': 'warn',

			'jsdoc/no-undefined-types': 'off',
			'jsdoc/reject-any-type': 'off',
			'jsdoc/reject-function-type': 'off',
			'jsdoc/require-jsdoc': 'off',
			'jsdoc/require-param': 'off',
			'jsdoc/require-param-description': 'off',
			'jsdoc/require-returns': 'off',
			'jsdoc/require-returns-description': 'off',
			'jsdoc/tag-lines': 'off',

			'write-good-comments/write-good-comments': 'warn',

			'spellcheck/spell-checker': ['warn', require('./spellcheck.config.cjs')],
		},
	},
	{
		files: ['test-setup.js', '**/*.test.js'],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				...globals.jest,
				Bun: false,
				mock: true,
				spyOn: true,
				setSystemTime: true,
			},
		},
		rules: {
			'no-console': 'off',
			'jsdoc/require-jsdoc': 'off',
		},
	},
];
