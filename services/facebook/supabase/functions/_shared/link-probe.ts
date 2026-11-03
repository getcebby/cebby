// Check-only read of one Facebook event page: fetch and parse exactly like an
// import, return the fields a link check judges, and save nothing.
import type { LinkProbe } from '@service/core/supabase/shared/health-checks.ts';
import { parseEventHtml } from './fb-event-scraper/index.ts';
import { fetchEvent, HttpStatusError } from './fb-event-scraper/network.ts';
import { validateAndFormatUrl } from './fb-event-scraper/url.ts';

export async function probeFacebookEventPage(url: string): Promise<LinkProbe> {
    let canonical: string;
    try {
        // Always rebuilds the URL on www.facebook.com from the event id.
        canonical = validateAndFormatUrl(url);
    } catch {
        return { kind: 'skip', reason: 'not a Facebook event URL' };
    }

    let html: string;
    try {
        html = await fetchEvent(canonical);
    } catch (error) {
        if (error instanceof HttpStatusError && (error.status === 404 || error.status === 410)) {
            return { kind: 'skip', reason: `gone (HTTP ${error.status})` };
        }
        throw error;
    }

    const event = parseEventHtml(html);
    return {
        kind: 'parsed',
        fields: {
            name: event.name,
            start_time: new Date(event.startTimestamp * 1000).toISOString(),
            location: event.location?.name ?? null,
        },
    };
}
