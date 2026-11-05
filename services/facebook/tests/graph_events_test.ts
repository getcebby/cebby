import { afterEach, describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { type Stub, stub } from 'jsr:@std/testing/mock';
import {
    classifyGraphError,
    fetchGraphEvents,
    GraphApiError,
    withoutEndedEvents,
} from '../supabase/functions/_shared/graph-events.ts';

let fetchStub: Stub<typeof globalThis, Parameters<typeof fetch>, Promise<Response>> | null = null;

/** Answers the Graph API pages in order: page 1 is the first fetch, page 2 the second, and so on. */
function stubPages(...pages: Array<{ status?: number; body: unknown }>) {
    const urls: string[] = [];
    fetchStub = stub(globalThis, 'fetch', (input: string | URL | Request) => {
        urls.push(input instanceof Request ? input.url : String(input));
        const page = pages[urls.length - 1] ?? { status: 599, body: { error: { message: 'no more pages' } } };
        return Promise.resolve(Response.json(page.body, { status: page.status ?? 200 }));
    });
    return urls;
}

afterEach(() => {
    fetchStub?.restore();
    fetchStub = null;
});

const URL1 = 'https://graph.facebook.com/v21.0/123/events?access_token=t';
const e1 = { id: '1', name: 'One' };
const e2 = { id: '2', name: 'Two' };

describe('fetchGraphEvents', () => {
    it('follows paging.next and returns every page', async () => {
        const urls = stubPages(
            { body: { data: [e1], paging: { next: 'https://graph.facebook.com/p2' } } },
            { body: { data: [e2] } },
        );
        expect(await fetchGraphEvents(URL1)).toEqual([e1, e2]);
        expect(urls).toEqual([URL1, 'https://graph.facebook.com/p2']);
    });

    it('fails with the Graph error message on an expired token', async () => {
        stubPages({
            status: 400,
            body: { error: { message: 'Error validating access token: Session has expired' } },
        });
        await expect(fetchGraphEvents(URL1)).rejects.toThrow('Error validating access token');
    });

    it('fails on an error body even with HTTP 200', async () => {
        stubPages({ body: { error: { message: 'x' } } });
        await expect(fetchGraphEvents(URL1)).rejects.toThrow('Graph API: x');
    });

    it('fails when the body has no data list', async () => {
        stubPages({ body: {} });
        await expect(fetchGraphEvents(URL1)).rejects.toThrow('Graph API');
    });

    it('fails instead of returning a partial list when a later page errors', async () => {
        stubPages(
            { body: { data: [e1], paging: { next: 'https://graph.facebook.com/p2' } } },
            { status: 500, body: {} },
        );
        await expect(fetchGraphEvents(URL1)).rejects.toThrow('HTTP 500');
    });
});

async function failureOf(page: { status?: number; body: unknown }) {
    stubPages(page);
    try {
        await fetchGraphEvents(URL1);
    } catch (err) {
        return err;
    }
    throw new Error('fetchGraphEvents did not fail');
}

describe('classifyGraphError', () => {
    it('keeps the Graph error code on the thrown error', async () => {
        const err = await failureOf({ status: 400, body: { error: { code: 190, message: 'Session has expired' } } });
        expect(err).toBeInstanceOf(GraphApiError);
        expect((err as GraphApiError).code).toBe(190);
        expect((err as GraphApiError).status).toBe(400);
    });

    it('reads an expired or revoked token as token_rejected', async () => {
        const err = await failureOf({ status: 400, body: { error: { code: 190, message: 'Session has expired' } } });
        expect(classifyGraphError(err)).toEqual({ code: 'token_rejected', detail: 'Graph API: Session has expired' });
    });

    it('reads a missing permission as permission_denied', async () => {
        const err = await failureOf({ status: 403, body: { error: { code: 10, message: 'no permission' } } });
        expect(classifyGraphError(err).code).toBe('permission_denied');
    });

    it('reads a throttled call as rate_limited', async () => {
        const err = await failureOf({ status: 400, body: { error: { code: 4, message: 'too many calls' } } });
        expect(classifyGraphError(err).code).toBe('rate_limited');
    });

    it('reads an HTTP error without a Graph code as a failed fetch', async () => {
        const err = await failureOf({ status: 500, body: {} });
        expect(classifyGraphError(err).code).toBe('fetch_failed');
    });

    it('reads a network error as a failed fetch', () => {
        expect(classifyGraphError(new TypeError('network'))).toEqual({ code: 'fetch_failed', detail: 'network' });
    });

    it('drops the page token when a network error quotes the URL', () => {
        const err = new TypeError(`error sending request for url (${URL1}&format=json)`);
        expect(classifyGraphError(err).detail).toBe(
            'error sending request for url (https://graph.facebook.com/v21.0/123/events?access_token=REDACTED&format=json)',
        );
    });

    it('reads an unknown Graph code as other', async () => {
        const err = await failureOf({ status: 400, body: { error: { code: 1, message: 'unknown' } } });
        expect(classifyGraphError(err).code).toBe('other');
    });
});

describe('withoutEndedEvents', () => {
    // 2026-11-05 08:30 in Cebu.
    const NOW = new Date('2026-11-05T00:30:00Z');
    const ev = (id: string, start_time: string, end_time?: string) => ({
        id,
        start_time,
        ...(end_time && { end_time }),
    });

    it('drops an event that ended and keeps one still to come', () => {
        const ended = ev('ended', '2017-03-04T09:00:00+0800', '2017-03-04T17:00:00+0800');
        const upcoming = ev('upcoming', '2026-11-21T14:00:00+0800', '2026-11-21T17:00:00+0800');
        expect(withoutEndedEvents([ended, upcoming], NOW)).toEqual([upcoming]);
    });

    it('keeps an event that started but has not ended', () => {
        const running = ev('running', '2026-11-05T08:00:00+0800', '2026-11-05T12:00:00+0800');
        expect(withoutEndedEvents([running], NOW)).toEqual([running]);
    });

    it('judges an event without an end time by its start time', () => {
        const started = ev('started', '2026-11-05T08:00:00+0800');
        const later = ev('later', '2026-11-05T09:00:00+0800');
        expect(withoutEndedEvents([started, later], NOW)).toEqual([later]);
    });

    it("reads Graph's offset times, not local ones", () => {
        // 09:00 in Cebu is 01:00Z, half an hour after NOW, though 09:00Z would be long after it too.
        const endsAt9 = ev('endsAt9', '2026-11-05T07:00:00+0800', '2026-11-05T09:00:00+0800');
        // 08:00 in Cebu is 00:00Z, already over, though read as 08:00Z it would still be ahead.
        const endedAt8 = ev('endedAt8', '2026-11-05T07:00:00+0800', '2026-11-05T08:00:00+0800');
        expect(withoutEndedEvents([endsAt9, endedAt8], NOW)).toEqual([endsAt9]);
    });

    it("keeps an event whose times can't be read", () => {
        const unreadable = ev('unreadable', 'soon');
        expect(withoutEndedEvents([unreadable], NOW)).toEqual([unreadable]);
    });
});
