import { afterEach, describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { type Stub, stub } from 'jsr:@std/testing/mock';
import { parseMeetupEventHtml, probeMeetupEventPage } from '../supabase/functions/_shared/meetuputils.ts';
import { EVENT_URL, eventPage, nextDataPage } from './helpers.ts';

let fetchStub: Stub<typeof globalThis, Parameters<typeof fetch>, Promise<Response>> | null = null;

/** Replaces fetch with one that always answers `body` at `status`, recording the URLs asked for. */
function stubFetch(status: number, body = '') {
    const urls: string[] = [];
    fetchStub = stub(globalThis, 'fetch', (input: string | URL | Request) => {
        urls.push(input instanceof Request ? input.url : String(input));
        return Promise.resolve(new Response(body, { status }));
    });
    return urls;
}

afterEach(() => {
    fetchStub?.restore();
    fetchStub = null;
});

const UPCOMING = '2026-11-21T09:00:00+08:00';
const PAST = '2025-06-14T09:00:00+08:00';

describe('probeMeetupEventPage', () => {
    it('reads the title, start time and location from an upcoming event page', async () => {
        const urls = stubFetch(200, eventPage(UPCOMING));
        expect(await probeMeetupEventPage(EVENT_URL)).toEqual({
            kind: 'parsed',
            fields: {
                name: 'AWS Student Builder Day',
                start_time: UPCOMING,
                location: 'National University Cebu, Mandaue City',
            },
        });
        expect(urls).toEqual([EVENT_URL]);
    });

    it('reads a past event too', async () => {
        stubFetch(200, eventPage(PAST));
        const result = await probeMeetupEventPage(EVENT_URL);
        expect(result.kind).toBe('parsed');
    });

    it('skips an event that is gone', async () => {
        stubFetch(404);
        expect(await probeMeetupEventPage(EVENT_URL)).toEqual({ kind: 'skip', reason: 'gone (HTTP 404)' });
    });

    it('fails on a server error', async () => {
        stubFetch(503);
        await expect(probeMeetupEventPage(EVENT_URL)).rejects.toThrow('HTTP 503');
    });

    it('skips a URL that is not a Meetup event, without fetching', async () => {
        const urls = stubFetch(200, eventPage(UPCOMING));
        expect(await probeMeetupEventPage('https://evil.example/g/events/1/')).toEqual({
            kind: 'skip',
            reason: 'not a Meetup event URL',
        });
        expect(urls).toEqual([]);
    });

    it('fails when the page has no Apollo state', async () => {
        stubFetch(200, nextDataPage({}));
        await expect(probeMeetupEventPage(EVENT_URL)).rejects.toThrow('no event data on page');
    });
});

describe('parseMeetupEventHtml', () => {
    it('drops a past event unless asked to keep it, as imports always have', () => {
        expect(parseMeetupEventHtml(eventPage(PAST), EVENT_URL, { allowPast: false })).toBeNull();
        expect(parseMeetupEventHtml(eventPage(PAST), EVENT_URL, { allowPast: true })?.name).toBe(
            'AWS Student Builder Day',
        );
    });
});
