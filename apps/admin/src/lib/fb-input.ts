/**
 * Parse free-text FB input from the admin "Add watched page" form into a
 * canonical slug/id we can persist on accounts.discovery_path /
 * accounts.account_id. Operator-friendly: accepts bare slugs, "@slug"
 * usernames, full facebook.com URLs (page, profile, /events, etc.),
 * and pure numeric profile ids.
 */

export interface ParsedFbInput {
    slug: string;
    shape: 'slug' | 'numeric-profile';
}

export interface ParseError {
    error: string;
}

export function parseFbInput(raw: string): ParsedFbInput | ParseError {
    let s = (raw ?? '').trim();
    if (!s) return { error: 'Please enter a Facebook page slug or URL.' };

    // Full URL form — extract slug/id from path.
    if (/^https?:\/\//i.test(s)) {
        let u: URL;
        try {
            u = new URL(s);
        } catch {
            return { error: 'That URL is not valid.' };
        }
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        if (host !== 'facebook.com' && host !== 'fb.com' && host !== 'm.facebook.com') {
            return { error: `Expected a facebook.com URL but got "${host}".` };
        }
        // profile.php?id=N — numeric profile shape
        if (u.pathname.startsWith('/profile.php')) {
            const id = u.searchParams.get('id');
            if (!id || !/^\d+$/.test(id)) {
                return { error: 'profile.php URL is missing the numeric id parameter.' };
            }
            return { slug: id, shape: 'numeric-profile' };
        }
        // Otherwise: first non-empty path segment is the slug.
        const seg = u.pathname.replace(/^\/+/, '').split('/')[0];
        if (!seg) return { error: 'URL has no path — cannot detect a page slug.' };
        s = seg;
    }

    // Strip a leading "@" (FB scraper rejects it as "Invalid Facebook page event URL").
    s = s.replace(/^@+/, '');
    if (!s) return { error: 'Input was just "@" — provide a page slug.' };

    // Pure-numeric input → numeric profile id.
    if (/^\d+$/.test(s)) return { slug: s, shape: 'numeric-profile' };

    // Otherwise must be a plausible FB slug. FB usernames allow letters,
    // digits, dot, dash, underscore. (Existing v1 examples include
    // "notion.cebu", "DICTr7".)
    if (!/^[a-zA-Z0-9._-]+$/.test(s)) {
        return { error: `"${s}" contains characters not allowed in a Facebook page slug.` };
    }

    return { slug: s, shape: 'slug' };
}
