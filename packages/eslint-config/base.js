import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import turboConfig from 'eslint-config-turbo/flat';
import onlyWarnPlugin from 'eslint-plugin-only-warn';
import tsEslint from 'typescript-eslint';

export const config = tsEslint.config(
    eslint.configs.recommended,
    prettierConfig,
    ...turboConfig,
    ...tsEslint.configs.recommended,
    {
        rules: {
            'turbo/no-undeclared-env-vars': 'warn',
        },
    },
    {
        plugins: {
            onlyWarn: onlyWarnPlugin,
        },
    },
    {
        ignores: ['node_modules/**', 'dist/**'],
    },
);
