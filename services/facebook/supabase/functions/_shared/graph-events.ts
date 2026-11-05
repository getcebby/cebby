// Partner pages' events from the Graph API. Kept free of runtime imports so it
// can be tested without Supabase env.
import { type ReadFailure, redactSecrets } from '@service/core/supabase/shared/health-checks.ts';
import type { FacebookEvent } from './types.ts';

interface GraphPage {
    data?: unknown;
    paging?: { next?: string };
    error?: { message?: string; code?: number };
}

/** A failed Graph API page: its error code (when Graph sent one) and HTTP status. */
export class GraphApiError extends Error {
    constructor(message: string, readonly code: number | null, readonly status: number) {
        super(message);
        this.name = 'GraphApiError';
    }
}

// https://developers.facebook.com/docs/graph-api/guides/error-handling
const TOKEN_CODES = new Set([102, 190, 463, 467]);
const RATE_CODES = new Set([4, 17, 32, 613]);

/** Why a partner page's Graph call failed, as the cron's health row records it. */
export function classifyGraphError(err: unknown): ReadFailure {
    // A network error's message can quote the URL, which carries the page token.
    const detail = redactSecrets(err instanceof Error ? err.message : String(err));
    if (!(err instanceof GraphApiError)) return { code: 'fetch_failed', detail };
    const { code, status } = err;
    if (code !== null && TOKEN_CODES.has(code)) return { code: 'token_rejected', detail };
    if (code !== null && (code === 10 || (code >= 200 && code <= 299))) return { code: 'permission_denied', detail };
    if ((code !== null && RATE_CODES.has(code)) || status === 429) return { code: 'rate_limited', detail };
    if (code === null && status >= 400) return { code: 'fetch_failed', detail };
    return { code: 'other', detail };
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
            throw new GraphApiError(`Graph API: ${reason}`, body?.error?.code ?? null, response.status);
        }

        events.push(...(body.data as FacebookEvent[]));
        next = body.paging?.next;
    }

    return events;
}

/**
 * The events that haven't ended yet: an event ends at its `end_time`, or at its
 * `start_time` when it has none. An event whose times can't be read is kept.
 *
 * Graph lists every event a page has ever had, and the cron does real work per
 * event (it reads each event's public page for its hosts and rewrites the row),
 * so syncing ended events made each run grow with the page's history until the
 * biggest pages ran out of CPU together (HTTP 546) and never reported back. The
 * watched-page path already keeps only events Facebook doesn't call past.
 */
export function withoutEndedEvents<T extends { start_time: string; end_time?: string }>(events: T[], now: Date): T[] {
    return events.filter((event) => {
        const endsAt = Date.parse(event.end_time ?? event.start_time);
        return Number.isNaN(endsAt) || endsAt >= now.getTime();
    });
}
