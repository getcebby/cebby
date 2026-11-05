import { Event } from '../../shared/types.ts';

const transliterationMap: { [key: string]: string } = {
    á: 'a',
    à: 'a',
    ã: 'a',
    â: 'a',
    ä: 'a',
    é: 'e',
    è: 'e',
    ê: 'e',
    ë: 'e',
    í: 'i',
    ì: 'i',
    î: 'i',
    ï: 'i',
    ó: 'o',
    ò: 'o',
    õ: 'o',
    ô: 'o',
    ö: 'o',
    ú: 'u',
    ù: 'u',
    û: 'u',
    ü: 'u',
    ý: 'y',
    ÿ: 'y',
    ñ: 'n',
    ç: 'c',
};

export const generateEventSlug = (event: Event): string => {
    if (!event.name) return String(event.id);

    const transliterated = event.name
        .toLowerCase()
        .split('')
        .map((char) => transliterationMap[char] || char)
        .join('');

    const title = transliterated
        .trim()
        .replace(/[^a-z0-9\s]+/gi, '')
        .replace(/\s+/g, '-')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '');

    return `${title}--${event.id}`.toLowerCase();
};

// --- Hosted cover keys ----------------------------------------------------------
//
// A hosted cover's R2 key names the source image it was copied from, so a sync can
// tell "same poster, keep the hosted copy" from "new poster, re-host it" without
// downloading anything, and a new poster gets a new URL past the year-long
// immutable cache.

/**
 * The part of a source cover URL that names the image: its path. The CDN host and
 * the query are dropped because Facebook serves the same image from several hosts
 * and re-signs its query (oh, oe, ...) on every fetch.
 */
export function coverSourceIdentity(url: string): string {
    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
}

/** The R2 key for an event's copy of a source cover, without its file extension. */
export async function hostedCoverKeyStem(
    event: { id: number; slug: string | null },
    sourceUrl: string,
): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(coverSourceIdentity(sourceUrl)));
    const hash = Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
    return `events/${event.slug ?? `event-${event.id}`}-${hash}`;
}

/**
 * The cover a canonical update writes. It keeps the event's hosted cover when that
 * is already the copy of the incoming source image; otherwise it takes the source
 * URL, which storeCoverImages then re-hosts. Writing the source URL every sync used
 * to replace the hosted copy, and a run that died before re-hosting left the event
 * on an expiring Facebook URL.
 */
export async function chooseCanonicalCover(args: {
    id: number;
    slug: string | null;
    current: string | null;
    incoming: string | null;
    publicUrl: string | null;
}): Promise<string | null> {
    const { current, incoming, publicUrl } = args;
    if (!current || !incoming || !publicUrl) return incoming;
    const hostedStem = `${publicUrl}/${await hostedCoverKeyStem(args, incoming)}.`;
    return current.startsWith(hostedStem) ? current : incoming;
}
