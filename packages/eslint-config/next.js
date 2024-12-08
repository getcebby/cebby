import globals from 'globals';
import { config as baseConfig } from './base.js';

/** @type {import("eslint").Linter.Config} */
export const config = [
    ...baseConfig,
    {
        languageOptions: {
            sourceType: 'module',
            ecmaVersion: 2022,
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parserOptions: {
                projectService: true,
            },
        },
    },
];
