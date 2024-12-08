import globals from 'globals';
import { config as baseConfig } from './base.js';

/*
 * This is a custom ESLint configuration for use with
 * internal (bundled by their consumer) libraries
 * that utilize React.
 */

/** @type {import("eslint").Linter.Config} */
export const config = [
    ...baseConfig,
    {
        languageOptions: {
            sourceType: 'module',
            ecmaVersion: 2022,
            globals: {
                ...globals.browser,
            },
            parserOptions: {
                projectService: true,
            },
        },
    },
];
