import { config } from '@repo/eslint-config/next';
import astroPlugin from 'eslint-plugin-astro';

export default [...config, ...astroPlugin.configs.recommended];
