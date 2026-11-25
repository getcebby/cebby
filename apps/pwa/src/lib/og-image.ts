// Facebook's crawler fetches og:image with `Range: bytes=0-524288` and reads only those
// bytes. R2 (images.getcebby.com) and Pages both honour Range, so an og:image over 512 KB
// reaches Facebook cut off: it reports "Image Too Small" and previews some other <img> from
// the page instead. Covers are stored exactly as their source served them (some are over
// 1 MB), so og:image is a Cloudflare Images transformation instead: one 1200x630 JPEG, far
// under the cap, with a size we can declare so Facebook can render it on the first share.
// https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

const SITE = 'https://www.getcebby.com';

// Transformations read sources from the getcebby.com zone only; other hosts would need
// "resize from any origin", and onerror=redirect works for same-zone sources only.
const ZONE_HOSTS = new Set(['www.getcebby.com', 'getcebby.com', 'images.getcebby.com']);

// Cloudflare can't read AVIF (cf-resized: err=9520, "format is not supported"): it redirects
// to the original, which would contradict the declared 1200x630 JPEG.
const UNREADABLE = /\.avif$/i;

// fit=pad keeps a whole poster in frame (no cropped titles) and fills the rest with the
// page's cream. onerror=redirect falls back to the original file if a transformation
// fails, for example past the Free plan's 5,000 unique transformations a month.
const OPTIONS = [
    `width=${OG_IMAGE_WIDTH}`,
    `height=${OG_IMAGE_HEIGHT}`,
    'fit=pad',
    'background=%23FAFAF9',
    'format=jpeg',
    'onerror=redirect',
].join(',');

export interface OgImage {
    url: string;
    width?: number;
    height?: number;
    type?: string;
}

/** The og:image for a site path (`/og.png`) or an image URL, as link-preview crawlers get it. */
export function ogImage(image: string): OgImage {
    const isSiteAsset = !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(image);
    const url = new URL(image, SITE);
    if (!ZONE_HOSTS.has(url.hostname) || UNREADABLE.test(url.pathname)) return { url: url.href };
    // A site asset goes by its path: crawlers only fetch public URLs, so transform the
    // production copy even when this page was rendered locally or on a preview deploy.
    return rendition(isSiteAsset ? url.pathname.replace(/^\/+/, '') : url.href);
}

function rendition(source: string): OgImage {
    return {
        url: `${SITE}/cdn-cgi/image/${OPTIONS}/${source}`,
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        type: 'image/jpeg',
    };
}
