import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Manual single-URL scrape entry point for the admin.
 *
 * Posted by /scrape:
 *   source = luma | facebook | meetup
 *   url    = the canonical event URL on that platform
 *
 * All three scrapers now run synchronously — fb-scraper, luma-scraper, and
 * meetup-scraper await processEvent and return:
 *
 *   { message: 'Event processed', result: IngestResult | null }
 *
 * On success we redirect to /events/<event_id>. On null result we surface
 * a useful flash so the operator knows whether the URL was bad, the event
 * was filtered (past, no Page-type hosts on FB, etc), or the scrape failed.
 */

type Source = 'luma' | 'facebook' | 'meetup';

const FN_BY_SOURCE: Record<Source, string> = {
    luma: 'luma-scraper',
    facebook: 'fb-scraper',
    meetup: 'meetup-scraper',
};

// Upstream scrapers throw with specific reasons now (see fb-scraper /
// luma-scraper / meetup-scraper). result===null only fires when the scrape
// succeeded and the upstream matcher returned nothing — rare, almost
// always a transient DB hiccup. One generic message covers it.
const NULL_RESULT_HINT: Record<Source, string> = {
    luma: 'Scrape succeeded but the ingest matcher returned no result. Retry — this is usually transient.',
    facebook: 'Scrape succeeded but the ingest matcher returned no result. Retry — this is usually transient.',
    meetup: 'Scrape succeeded but the ingest matcher returned no result. Possibly a past event filtered out. Retry or check the URL.',
};

function backToForm(reason: string, kind: 'success' | 'error' | 'info' = 'error'): Response {
    return new Response(null, {
        status: 303,
        headers: {
            Location: `/scrape?flash=${kind}&msg=${encodeURIComponent(reason)}`,
        },
    });
}

interface UrlMatch {
    /** The body we POST to the edge function. */
    body: Record<string, string>;
}

/**
 * Validate the input URL against the chosen source. Reject mismatches with
 * a useful message instead of letting them propagate to the scraper.
 */
function resolveMatch(source: Source, raw: string): { match?: UrlMatch; reason?: string } {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { reason: 'Invalid URL' };
    }

    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');

    if (source === 'meetup') {
        if (host !== 'www.meetup.com' && host !== 'meetup.com') {
            return { reason: 'Expected a meetup.com URL' };
        }
        const m = path.match(/^\/([^/]+)\/events\/(\d+)$/);
        if (!m) return { reason: 'Expected URL like https://www.meetup.com/<group>/events/<id>/' };
        return { match: { body: { url: `https://www.meetup.com/${m[1]}/events/${m[2]}/` } } };
    }

    if (source === 'facebook') {
        if (!host.endsWith('facebook.com') && !host.endsWith('fb.com')) {
            return { reason: 'Expected a facebook.com URL' };
        }
        const m = path.match(/\/events\/(\d+)/);
        if (!m) return { reason: 'Expected URL like https://www.facebook.com/events/<id>/' };
        const sourceId = m[1];
        return {
            match: {
                body: { url: `https://www.facebook.com/events/${sourceId}/`, id: sourceId },
            },
        };
    }

    // luma
    if (host !== 'lu.ma' && host !== 'luma.com' && host !== 'www.luma.com') {
        return { reason: 'Expected a lu.ma or luma.com URL' };
    }
    const slug = path.replace(/^\//, '').split('/')[0];
    if (!slug) return { reason: 'URL must include the event slug, e.g. https://lu.ma/abc123' };
    return { match: { body: { url: `https://luma.com/${slug}` } } };
}

interface ScrapeResponse {
    message?: string;
    error?: string;
    /** IngestResult — present on success. The fb/luma/meetup scrapers all
     *  share this shape now that they're synchronous. */
    result?: { event_id?: number; is_new_event?: boolean; became_canonical?: boolean } | null;
}

async function callEdgeFunction(
    fn: string,
    body: Record<string, string>,
): Promise<{ ok: boolean; httpStatus: number; payload: ScrapeResponse | null }> {
    const supaUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supaUrl || !serviceKey) {
        return { ok: false, httpStatus: 500, payload: { error: 'admin missing supabase env' } };
    }
    // Edge function timeout is ~60s; FB scrapes can hit ~15-20s, Luma ~10s,
    // Meetup ~5s. Give the fetch a comfortable 60s ceiling so a slow scrape
    // doesn't error out at the admin layer when the function is still running.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
        const res = await fetch(`${supaUrl}/functions/v1/${fn}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        let payload: ScrapeResponse | null = null;
        try {
            payload = (await res.json()) as ScrapeResponse;
        } catch {
            payload = { error: await res.text().catch(() => 'no body') };
        }
        return { ok: res.ok, httpStatus: res.status, payload };
    } catch (err) {
        const reason = err instanceof Error
            ? (err.name === 'AbortError' ? 'scrape timed out after 60s' : err.message)
            : String(err);
        return { ok: false, httpStatus: 0, payload: { error: reason } };
    } finally {
        clearTimeout(timeout);
    }
}

export const POST: APIRoute = async ({ request }) => {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return backToForm('Invalid form data');
    }

    const sourceRaw = (formData.get('source')?.toString() ?? '').toLowerCase();
    const url = formData.get('url')?.toString().trim() ?? '';

    if (!url) return backToForm('URL is required');
    if (sourceRaw !== 'luma' && sourceRaw !== 'facebook' && sourceRaw !== 'meetup') {
        return backToForm('Pick a source (Luma / Facebook / Meetup)');
    }
    const source = sourceRaw as Source;

    const { match, reason } = resolveMatch(source, url);
    if (!match || reason) return backToForm(reason ?? 'Could not parse URL for this source');

    const { ok, httpStatus, payload } = await callEdgeFunction(FN_BY_SOURCE[source], match.body);

    if (!ok) {
        // Upstream scrapers throw with self-describing messages (e.g.
        // "Facebook page scrape failed: rate-limited, retry in ~30s") —
        // forward verbatim instead of double-prefixing.
        return backToForm(payload?.error ?? `Scrape returned HTTP ${httpStatus}`);
    }

    const eventId = payload?.result?.event_id;
    if (!eventId) {
        // 200 but no event — scraper returned null. The hint differs per source
        // because the failure modes are different; surface it inline.
        return backToForm(NULL_RESULT_HINT[source], 'info');
    }

    const verb = payload?.result?.is_new_event ? 'Scraped (new event)' : 'Scraped (matched existing)';
    return new Response(null, {
        status: 303,
        headers: {
            Location: `/events/${eventId}?flash=success&msg=${encodeURIComponent(`${verb} from ${source}`)}`,
        },
    });
};
