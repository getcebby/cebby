import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import {
    E1_PAGE_CAP,
    fetchOrganizer,
    fetchSeriesDates,
    isSeriesParent,
    listOrganizerEvents,
} from '../supabase/functions/_shared/organizer-api.ts';

const FIXTURES = 'tests/fixtures/organizer';

function fixture(name: string): Promise<string> {
    return Deno.readTextFile(`${FIXTURES}/${name}`);
}

function jsonResponse(body: string, status = 200): Response {
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fetch that answers from `routes` (URL substring → response) and records every URL asked for. */
function fakeFetch(routes: [string, () => Promise<Response> | Response][]) {
    const calls: string[] = [];
    const fetchFn = async (url: string): Promise<Response> => {
        calls.push(url);
        const route = routes.find(([part]) => url.includes(part));
        if (!route) throw new Error(`unexpected fetch ${url}`);
        return await route[1]();
    };
    return { calls, fetchFn };
}

const status = (code: number) => () => new Response('nope', { status: code });

describe('listOrganizerEvents', () => {
    it("reads an organizer's upcoming events, with each event's place", async () => {
        const body = await fixture('code-orange-events.json');
        const { calls, fetchFn } = fakeFetch([['/organizers/110850996031/events/', () => jsonResponse(body)]]);
        const result = await listOrganizerEvents('110850996031', fetchFn);
        if (!result.ok) throw new Error('expected ok');
        expect(result.events).toHaveLength(17);
        const cebu = result.events.find((e) => e.id === '2002279245122');
        expect(cebu?.isOnline).toBe(false);
        expect(cebu?.venue?.city).toBe('Cebu City');
        expect(cebu?.venue?.country).toBe('PH');
        expect(calls).toEqual([
            'https://www.eventbrite.com/organizer-profile/api/organizers/110850996031/events/?page=1&pageSize=50',
        ]);
    });

    it('counts a quiet organizer as read', async () => {
        const body = await fixture('wtm-cebu-events.json');
        const { fetchFn } = fakeFetch([['/events/', () => jsonResponse(body)]]);
        expect(await listOrganizerEvents('109571894561', fetchFn)).toEqual({ ok: true, events: [] });
    });

    it('fails on an HTTP error with its cause', async () => {
        for (const [code, cause] of [[500, 'fetch_failed'], [429, 'rate_limited']] as const) {
            const { fetchFn } = fakeFetch([['/events/', status(code)]]);
            const result = await listOrganizerEvents('1', fetchFn);
            expect(result.ok ? null : result.failure.code).toBe(cause);
        }
    });

    it('fails on a 200 HTML page or JSON without events, never "read, nothing upcoming"', async () => {
        const html = () => new Response('<html>Checking your browser</html>', { headers: { 'Content-Type': 'text/html' } });
        const noEvents = () => jsonResponse('{"error":"oops"}');
        for (const answer of [html, noEvents]) {
            const { fetchFn } = fakeFetch([['/events/', answer]]);
            const result = await listOrganizerEvents('1', fetchFn);
            expect(result.ok ? null : result.failure.code).toBe('unexpected_page');
        }
    });

    it('follows hasMore to the next page', async () => {
        const event = (id: string) => ({ id, name: id, url: `https://www.eventbrite.com/e/${id}`, is_online_event: true });
        const { calls, fetchFn } = fakeFetch([
            ['page=1&', () => jsonResponse(JSON.stringify({ events: [event('a')], hasMore: true, total: 2 }))],
            ['page=2&', () => jsonResponse(JSON.stringify({ events: [event('b')], hasMore: false, total: 2 }))],
        ]);
        const result = await listOrganizerEvents('1', fetchFn);
        expect(result.ok ? result.events.map((e) => e.id) : null).toEqual(['a', 'b']);
        expect(calls.map((u) => new URL(u).searchParams.get('page'))).toEqual(['1', '2']);
    });

    it('stops at the page cap when hasMore never ends, and still counts as read', async () => {
        const { calls, fetchFn } = fakeFetch([
            ['/events/', () => jsonResponse(JSON.stringify({ events: [], hasMore: true, total: 999 }))],
        ]);
        const result = await listOrganizerEvents('1', fetchFn);
        expect(result.ok).toBe(true);
        expect(calls).toHaveLength(E1_PAGE_CAP);
    });
});

describe('fetchOrganizer', () => {
    it('returns the name of an organizer that exists', async () => {
        const body = await fixture('code-orange-organizer.json');
        const { calls, fetchFn } = fakeFetch([['/api/v3/organizers/110850996031/', () => jsonResponse(body)]]);
        expect(await fetchOrganizer('110850996031', fetchFn)).toEqual({ ok: true, name: 'Code Orange Dev School' });
        expect(calls).toEqual(['https://www.eventbrite.com/api/v3/organizers/110850996031/']);
    });

    it('reports a bad id as not found', async () => {
        const body = await fixture('organizer-404.json');
        const { fetchFn } = fakeFetch([['/organizers/', () => jsonResponse(body, 404)]]);
        const result = await fetchOrganizer('99999999999', fetchFn);
        expect(result.ok ? null : result.failure.code).toBe('not_found');
    });

    it('reports other failures with their cause', async () => {
        for (const [answer, cause] of [
            [status(500), 'fetch_failed'],
            [status(429), 'rate_limited'],
            [() => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }), 'unexpected_page'],
        ] as const) {
            const { fetchFn } = fakeFetch([['/organizers/', answer]]);
            const result = await fetchOrganizer('1', fetchFn);
            expect(result.ok ? null : result.failure.code).toBe(cause);
        }
    });
});

describe('isSeriesParent', () => {
    it('tells a series parent from a one-off event', async () => {
        const parent = await fixture('series-parent-event.json');
        const oneOff = await fixture('one-off-event.json');
        const { calls, fetchFn } = fakeFetch([
            ['/events/2002279245122/', () => jsonResponse(parent)],
            ['/events/1999999999999/', () => jsonResponse(oneOff)],
        ]);
        expect(await isSeriesParent('2002279245122', fetchFn)).toBe(true);
        expect(await isSeriesParent('1999999999999', fetchFn)).toBe(false);
        expect(calls[0]).toBe('https://www.eventbrite.com/api/v3/events/2002279245122/');
    });
});

describe('fetchSeriesDates', () => {
    it("lists a series' current and future dates with their UTC start", async () => {
        const body = await fixture('bitcoin-meetup-series-dates.json');
        const { calls, fetchFn } = fakeFetch([['/series/2002279245122/events/', () => jsonResponse(body)]]);
        const dates = await fetchSeriesDates('2002279245122', fetchFn);
        expect(dates[0]).toEqual({ id: '2004210346097', startUtc: '2026-11-06T11:00:00Z' });
        expect(dates).toHaveLength(39);
        expect(calls).toEqual([
            'https://www.eventbrite.com/api/v3/series/2002279245122/events/?time_filter=current_future',
        ]);
    });
});
