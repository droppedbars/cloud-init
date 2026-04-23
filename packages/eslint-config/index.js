const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const prettierPlugin = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');
const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        ignores: ['**/bin/**', '**/node_modules/**', 'eslint.config.js'],
    },
    {
        files: ['**/*.ts', '**/*.js'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2020,
                sourceType: 'module',
            },
            globals: {
                console: 'readonly',
                module: 'readonly',
                require: 'readonly',
                process: 'readonly',
                __dirname: 'readonly',
            }
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            'prettier': prettierPlugin,
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            ...prettierPlugin.configs.recommended.rules,
            ...prettierConfig.rules,

            // Add any specific rules here. For example:
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
];
