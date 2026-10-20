import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { parseEventbriteEventUrl, fetchEventbriteEvent } from '../_shared/eventbriteutils.ts';

/**
 * Manual single-URL Eventbrite ingest.
 *
 * Scaffold: validates URL shape, then returns 501 until the scraper lands.
 * Wire-up target for admin `/api/scrape` (source=eventbrite).
 */
Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    try {
        const body = await req.json() as { url?: string };
        const url = body.url?.trim() ?? '';
        if (!url) {
            return new Response(JSON.stringify({ error: 'URL is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const parsed = parseEventbriteEventUrl(url);
        if (!parsed) {
            return new Response(
                JSON.stringify({
                    error: 'Expected an Eventbrite event URL like https://www.eventbrite.com/e/<slug>-<id>',
                }),
                { status: 400, headers: { 'Content-Type': 'application/json' } },
            );
        }

        // Will throw until implemented — surface as 501 for operators.
        try {
            await fetchEventbriteEvent(parsed.canonicalUrl);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('not implemented')) {
                return new Response(
                    JSON.stringify({
                        error: message,
                        todo: true,
                        eventbrite_id: parsed.eventId,
                        canonical_url: parsed.canonicalUrl,
                    }),
                    { status: 501, headers: { 'Content-Type': 'application/json' } },
                );
            }
            throw err;
        }

        return new Response(
            JSON.stringify({ error: 'Unreachable: scraper returned without implementing ingest' }),
            { status: 501, headers: { 'Content-Type': 'application/json' } },
        );
    } catch (error) {
        console.error('[eventbrite-scraper] error:', error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
    }
});
