import { afterEach, describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { type Stub, stub } from 'jsr:@std/testing/mock';
import { probeFacebookEventPage } from '../supabase/functions/_shared/link-probe.ts';
import { EVENT_ID, eventPage, START } from './helpers.ts';

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

describe('probeFacebookEventPage', () => {
    it('reads the title, start time and place from a real event page', async () => {
        const urls = stubFetch(200, eventPage());
        const result = await probeFacebookEventPage(`https://www.facebook.com/events/${EVENT_ID}/`);
        expect(result).toEqual({
            kind: 'parsed',
            fields: {
                name: 'Malfunction Hackathon IDE.A',
                start_time: new Date(START * 1000).toISOString(),
                location: 'iACADEMY Cebu',
            },
        });
        expect(urls.length).toBe(1);
        expect(urls[0].startsWith(`https://www.facebook.com/events/${EVENT_ID}`)).toBe(true);
    });

    it('skips an event that is gone', async () => {
        stubFetch(404);
        expect(await probeFacebookEventPage(`https://www.facebook.com/events/${EVENT_ID}/`)).toEqual({
            kind: 'skip',
            reason: 'gone (HTTP 404)',
        });
        fetchStub?.restore();
        stubFetch(410);
        expect(await probeFacebookEventPage(`https://www.facebook.com/events/${EVENT_ID}/`)).toEqual({
            kind: 'skip',
            reason: 'gone (HTTP 410)',
        });
    });

    it('fails on a server error', async () => {
        stubFetch(500);
        await expect(probeFacebookEventPage(`https://www.facebook.com/events/${EVENT_ID}/`)).rejects.toThrow(
            'HTTP 500',
        );
    });

    it('fails when the page has no time data', async () => {
        stubFetch(200, eventPage().replace(/"data":\{"tz_display_name"[^}]*\}/, '"data":{}'));
        await expect(probeFacebookEventPage(`https://www.facebook.com/events/${EVENT_ID}/`)).rejects.toThrow();
    });

    it('skips a URL that is not a Facebook event, without fetching', async () => {
        const urls = stubFetch(200, eventPage());
        expect(await probeFacebookEventPage('https://evil.example/whatever')).toEqual({
            kind: 'skip',
            reason: 'not a Facebook event URL',
        });
        expect(urls).toEqual([]);
    });

    it('only ever fetches from www.facebook.com', async () => {
        const urls = stubFetch(200, eventPage());
        await probeFacebookEventPage(`https://evil.example/facebook.com/events/${EVENT_ID}`).catch(() => {});
        for (const url of urls) expect(new URL(url).hostname).toBe('www.facebook.com');
    });
});
