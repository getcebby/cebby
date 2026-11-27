import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import SEO from '../src/components/SEO.astro';

// Facebook's crawler requests og:image with `Range: bytes=0-524288` and reads only what
// comes back. R2 and Pages honour Range, so an og:image over 512 KB arrives cut off,
// Facebook calls it "Image Too Small", and the link preview shows some other <img> from
// the page. This cover is 1,382,024 bytes in R2 and was the one that broke on 2026-11-25.
const BIG_COVER = 'https://images.getcebby.com/events/ai-growing-up-and-leaving-home--1775858457072-43a66f110a86.png';

async function render(image?: string, url = 'https://www.getcebby.com/events/an-event--1') {
    const container = await AstroContainer.create();
    return container.renderToString(SEO, {
        props: { title: 'An event - cebby', description: 'About it', ...(image ? { image } : {}) },
        request: new Request(url),
    });
}

function meta(html: string, property: string): string | undefined {
    const tag = html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`));
    return tag?.[1].replaceAll('&amp;', '&');
}

/** The source image a transformation URL points at, and its options. */
function transformation(url: string) {
    const m = url.match(/^https:\/\/www\.getcebby\.com\/cdn-cgi\/image\/([^/]+)\/(.+)$/);
    if (!m) return null;
    return { options: Object.fromEntries(m[1].split(',').map((kv) => kv.split('='))), source: m[2] };
}

describe('og:image', () => {
    it('serves a stored cover as a 1200x630 JPEG rendition, not the original file', async () => {
        const html = await render(BIG_COVER);
        const t = transformation(meta(html, 'og:image') ?? '');

        expect(t, `og:image was ${meta(html, 'og:image')}`).not.toBeNull();
        expect(t!.source).toBe(BIG_COVER);
        expect(t!.options).toMatchObject({ width: '1200', height: '630', format: 'jpeg' });
        expect(meta(html, 'og:image:width')).toBe('1200');
        expect(meta(html, 'og:image:height')).toBe('630');
        expect(meta(html, 'og:image:type')).toBe('image/jpeg');
        expect(meta(html, 'twitter:image')).toBe(meta(html, 'og:image'));
    });

    it('serves the default og.png (850 KB) through the same rendition', async () => {
        const t = transformation(meta(await render(), 'og:image') ?? '');

        expect(t).not.toBeNull();
        expect(t!.source).toBe('og.png');
        expect(t!.options).toMatchObject({ width: '1200', height: '630', format: 'jpeg' });
    });

    it('leaves an AVIF cover alone, since Cloudflare cannot read AVIF (cf-resized: err=9520)', async () => {
        // 27 of 530 covers were AVIF on 2026-11-25. Transforming one redirects to the original
        // .avif, which would contradict a declared 1200x630 JPEG.
        const avif = 'https://images.getcebby.com/events/kiro-token-maxxing--1775858457080-ebbc83b2f4ae.avif';
        const html = await render(avif);

        expect(meta(html, 'og:image')).toBe(avif);
        expect(meta(html, 'og:image:width')).toBeUndefined();
        expect(meta(html, 'og:image:height')).toBeUndefined();
        expect(meta(html, 'og:image:type')).toBeUndefined();
    });

    it('leaves an image on another host alone and declares no size for it', async () => {
        const meetup = 'https://secure.meetupstatic.com/photos/event/7/b/9/d/highres_537271645.jpeg';
        const html = await render(meetup);

        expect(meta(html, 'og:image')).toBe(meetup);
        expect(meta(html, 'og:image:width')).toBeUndefined();
        expect(meta(html, 'og:image:height')).toBeUndefined();
    });
});

describe('og:url and canonical', () => {
    it('leave out the query string, so a shared ?fbclid= or utm_ link is still the same page', async () => {
        // On 2026-11-27 the live event page echoed ?fbclid=IwTEST123&utm_source=fb into og:url,
        // twitter:url and the canonical link. Facebook keys its cache and share counts on og:url,
        // so each tracking link became a separate page to it.
        const page = 'https://www.getcebby.com/events/an-event--1';
        const html = await render(undefined, `${page}?fbclid=IwAR0abc&utm_source=facebook`);

        expect(meta(html, 'og:url')).toBe(page);
        expect(meta(html, 'twitter:url')).toBe(page);
        expect(html.match(/<link rel="canonical" href="([^"]*)"/)?.[1]).toBe(page);
    });
});
