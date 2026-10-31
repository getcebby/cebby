import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const titleTags = (markup: string) => markup.match(/<title[\s>]/g) ?? [];

describe('document title', () => {
    it('is rendered by Layout alone, so pages using SEO keep a single title tag', () => {
        expect(titleTags(source('layouts/Layout.astro'))).toHaveLength(1);
        expect(titleTags(source('components/SEO.astro'))).toHaveLength(0);
    });
});
