import { describe, expect, it } from 'vitest';
import { escapeHtml, jsonForScript, renderDescription } from '../src/lib/safe-html';

describe('escapeHtml', () => {
    it('escapes the characters that can start markup or end an attribute', () => {
        expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    });
});

describe('renderDescription', () => {
    it('wraps paragraphs and links URLs', () => {
        expect(renderDescription('Join us!\n\nRSVP at https://lu.ma/abc.')).toBe(
            '<p>Join us!</p><p>RSVP at <a href="https://lu.ma/abc" target="_blank" rel="noopener noreferrer" class="text-purple-700 hover:text-purple-900 underline break-all">https://lu.ma/abc</a>.</p>',
        );
    });

    it('renders scraped markup as text instead of HTML', () => {
        const html = renderDescription('<img src=x onerror="alert(1)"><script>alert(2)</script>');
        expect(html).not.toMatch(/<img|<script/);
        expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    });

    it('keeps a quote in a URL from breaking out of the href', () => {
        const html = renderDescription('See https://example.com/"onmouseover="alert(1) now');
        expect(html).not.toContain('onmouseover="');
        expect(html).toContain('<a href="https://example.com/"');
    });

    it('keeps query strings working in links', () => {
        expect(renderDescription('https://example.com/?a=1&b=2')).toContain('href="https://example.com/?a=1&amp;b=2"');
    });
});

describe('jsonForScript', () => {
    it('cannot close the surrounding script tag', () => {
        const out = jsonForScript({ name: '</script><script>alert(1)</script>' });
        expect(out).not.toContain('</script');
        expect(out).not.toContain('<');
    });

    it('round-trips through JSON.parse', () => {
        const value = { name: 'A & B <tag> \u2028 line', n: 1, list: ['x'] };
        expect(JSON.parse(jsonForScript(value))).toEqual(value);
    });
});
