import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = false;

/**
 * Manual single-URL scrape entry point for the admin.
 *
 * Posted by /scrape:
 *   source = luma | facebook | meetup
 *   url    = the canonical event URL on that platform
 *
 * Calls the corresponding Edge Function with the service-role JWT, then:
 *   • If the function ran synchronously and returned an event_id (meetup),
 *     redirect straight to /events/[id]?flash=success.
 *   • If it queued (luma, facebook — they use EdgeRuntime.waitUntil), poll
 *     event_source_links by the URL we know belongs to this scrape. If the
 *     row appears within ~15s, redirect to /events/[id]. Otherwise redirect
 *     back to /scrape with a "still processing" message.
 *
 * The polling step handles the queued-vs-sync inconsistency between the
 * three scrapers without requiring changes to the edge functions.
 */

type Source = 'luma' | 'facebook' | 'meetup';

const FN_BY_SOURCE: Record<Source, string> = {
    luma: 'luma-scraper',
    facebook: 'fb-scraper',
    meetup: 'meetup-scraper',
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
    /** What we POST to the edge function. */
    body: Record<string, string>;
    /** PostgREST filter for polling event_source_links to find the row this scrape produced. */
    pollFilter: { source: Source; key: 'source_id' | 'url'; value: string };
}

/**
 * Validate the input URL and derive the matching key we'll use to find the
 * resulting event_source_links row after the scrape lands.
 *
 * Returns null with a reason string if the URL doesn't look right for the
 * chosen source — caught here rather than propagating a 500 from the
 * scraper that wouldn't tell the operator anything actionable.
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
        const sourceId = m[2];
        const canonical = `https://www.meetup.com/${m[1]}/events/${sourceId}/`;
        return {
            match: {
                body: { url: canonical },
                pollFilter: { source: 'meetup', key: 'source_id', value: sourceId },
            },
        };
    }

    if (source === 'facebook') {
        if (!host.endsWith('facebook.com') && !host.endsWith('fb.com')) {
            return { reason: 'Expected a facebook.com URL' };
        }
        // /events/12345  or  /events/12345/?something
        const m = path.match(/\/events\/(\d+)/);
        if (!m) return { reason: 'Expected URL like https://www.facebook.com/events/<id>/' };
        const sourceId = m[1];
        const canonical = `https://www.facebook.com/events/${sourceId}/`;
        return {
            match: {
                body: { url: canonical, id: sourceId },
                pollFilter: { source: 'facebook', key: 'source_id', value: sourceId },
            },
        };
    }

    // luma
    if (host !== 'lu.ma' && host !== 'luma.com' && host !== 'www.luma.com') {
        return { reason: 'Expected a lu.ma or luma.com URL' };
    }
    const slug = path.replace(/^\//, '').split('/')[0];
    if (!slug) return { reason: 'URL must include the event slug, e.g. https://lu.ma/abc123' };
    const canonical = `https://luma.com/${slug}`;
    return {
        match: {
            body: { url: canonical },
            pollFilter: { source: 'luma', key: 'url', value: canonical },
        },
    };
}

async function callEdgeFunction(
    fn: string,
    body: Record<string, string>,
): Promise<{ ok: boolean; httpStatus: number; payload: unknown }> {
    const supaUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supaUrl || !serviceKey) {
        return { ok: false, httpStatus: 500, payload: { error: 'admin missing supabase env' } };
    }
    const res = await fetch(`${supaUrl}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(body),
    });
    let payload: unknown = null;
    try {
        payload = await res.json();
    } catch {
        payload = await res.text().catch(() => null);
    }
    return { ok: res.ok, httpStatus: res.status, payload };
}

interface SyncMeetupResult {
    message?: string;
    result?: { event_id?: number };
}

function eventIdFromMeetupResponse(payload: unknown): number | null {
    if (!payload || typeof payload !== 'object') return null;
    const r = (payload as SyncMeetupResult).result;
    return typeof r?.event_id === 'number' ? r.event_id : null;
}

async function pollForEventId(
    filter: UrlMatch['pollFilter'],
    timeoutMs = 15000,
    intervalMs = 1500,
): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const query = supabase
            .from('event_source_links')
            .select('event_id, scraped_at')
            .eq('source', filter.source)
            .eq(filter.key, filter.value)
            .order('scraped_at', { ascending: false })
            .limit(1);
        const { data } = await query;
        const row = (data ?? [])[0] as { event_id: number; scraped_at: string } | undefined;
        if (row) return row.event_id;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
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
        const errorMsg = (payload && typeof payload === 'object' && 'error' in payload
            ? (payload as { error: string }).error
            : `scrape returned HTTP ${httpStatus}`);
        return backToForm(`Scrape failed: ${errorMsg}`);
    }

    // Meetup runs synchronously and returns the IngestResult inline.
    if (source === 'meetup') {
        const eventId = eventIdFromMeetupResponse(payload);
        if (eventId) {
            return new Response(null, {
                status: 303,
                headers: {
                    Location: `/events/${eventId}?flash=success&msg=${encodeURIComponent('Scraped from Meetup')}`,
                },
            });
        }
        // The function responded 200 but didn't return an event_id (e.g. past
        // event filtered out, or Apollo state missing). Fall through to the
        // poll path so we don't lose the operator's input.
    }

    // Luma + Facebook (and meetup-with-no-result-payload) — poll for the
    // event_source_links row to land, then redirect.
    const eventId = await pollForEventId(match.pollFilter);
    if (eventId) {
        return new Response(null, {
            status: 303,
            headers: {
                Location: `/events/${eventId}?flash=success&msg=${encodeURIComponent(`Scraped from ${source}`)}`,
            },
        });
    }

    return backToForm(
        `Scrape queued (${source}) — event hasn't appeared yet. Refresh /events in a few seconds, or check the function logs if it doesn't show up.`,
        'info',
    );
};
