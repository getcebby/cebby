// Partner pages' events from the Graph API. Kept free of runtime imports so it
// can be tested without Supabase env.
import type { ReadFailure } from '@service/core/supabase/shared/health-checks.ts';
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
    const detail = err instanceof Error ? err.message : String(err);
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
