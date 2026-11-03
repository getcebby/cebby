// Partner pages' events from the Graph API. Kept free of runtime imports so it
// can be tested without Supabase env.
import type { FacebookEvent } from './types.ts';

interface GraphPage {
    data?: unknown;
    paging?: { next?: string };
    error?: { message?: string };
}

/**
 * Fetch every page of a Graph API events listing, following `paging.next`.
 * Throws on any failed page (expired token, HTTP error, error body, missing
 * `data`), so a broken partner path is never mistaken for "no events".
 * Error messages never include the URL, which carries the page's access token.
 */
export async function fetchGraphEvents(url: string): Promise<FacebookEvent[]> {
    const events: FacebookEvent[] = [];
    let next: string | undefined = url;

    while (next) {
        const response: Response = await fetch(next, { method: 'GET' });
        const body = (await response.json().catch(() => null)) as GraphPage | null;

        if (!response.ok || body?.error || !Array.isArray(body?.data)) {
            const reason = body?.error?.message ?? (response.ok ? 'no data in response' : `HTTP ${response.status}`);
            throw new Error(`Graph API: ${reason}`);
        }

        events.push(...(body.data as FacebookEvent[]));
        next = body.paging?.next;
    }

    return events;
}
