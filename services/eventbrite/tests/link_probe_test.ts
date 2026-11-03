import { afterEach, describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { type Stub, stub } from 'jsr:@std/testing/mock';
import { probeEventbriteEventPage } from '../supabase/functions/_shared/eventbriteutils.ts';

const fixture = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/${name}.html`, import.meta.url));
const occurrenceHtml = fixture('bitcoin-meetup-occurrence');
const seriesParentHtml = fixture('bitcoin-meetup-series-parent');

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

describe('probeEventbriteEventPage', () => {
    it('reads the title, start time and location from a single event page', async () => {
        const urls = stubFetch(200, occurrenceHtml);
        expect(
            await probeEventbriteEventPage('https://www.eventbrite.co.uk/e/bitcoin-meetup-cebu-tickets-2002279263176'),
        ).toEqual({
            kind: 'parsed',
            fields: {
                name: 'Bitcoin Meetup Cebu',
                start_time: '2026-12-30T11:00:00.000Z',
                location: 'CoffeeBay, Abad Street, Cebu City, Central Visayas 6000',
            },
        });
        expect(urls).toEqual(['https://www.eventbrite.com/e/2002279263176']);
    });

    it('skips a series parent page', async () => {
        stubFetch(200, seriesParentHtml);
        expect(await probeEventbriteEventPage('https://www.eventbrite.com/e/2002279245122')).toEqual({
            kind: 'skip',
            reason: 'series page',
        });
    });

    it('skips an event that is gone', async () => {
        stubFetch(404);
        expect(await probeEventbriteEventPage('https://www.eventbrite.com/e/2002279263176')).toEqual({
            kind: 'skip',
            reason: 'gone (HTTP 404)',
        });
    });

    it('fails on a server error', async () => {
        stubFetch(503);
        await expect(probeEventbriteEventPage('https://www.eventbrite.com/e/2002279263176')).rejects.toThrow(
            'HTTP 503',
        );
    });

    it('fails when the page has no event data', async () => {
        stubFetch(200, '<html><body>changed layout</body></html>');
        await expect(probeEventbriteEventPage('https://www.eventbrite.com/e/2002279263176')).rejects.toThrow(
            'no event data on page',
        );
    });

    it('skips a URL that is not an Eventbrite event, without fetching', async () => {
        const urls = stubFetch(200, occurrenceHtml);
        expect(await probeEventbriteEventPage('https://evil.example/e/x-123')).toEqual({
            kind: 'skip',
            reason: 'not an Eventbrite event URL',
        });
        expect(urls).toEqual([]);
    });
});
