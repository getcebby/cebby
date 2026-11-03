import { afterEach, describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { type Stub, stub } from 'jsr:@std/testing/mock';
import { parseLumaEventHtml, probeLumaEventPage } from '../supabase/functions/_shared/lumautils.ts';
import { nextDataPage } from './helpers.ts';

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

const EVENT = {
    api_id: 'evt-DGc0j5LmlqV1z',
    name: 'AWS Community Day Cebu',
    url: 'h285dxy6',
    start_at: '2026-11-21T01:00:00.000Z',
    end_at: '2026-11-21T09:00:00.000Z',
    timezone: 'Asia/Manila',
    location_type: 'offline',
    geo_address_info: { full_address: 'iACADEMY Cebu, Cebu City', city: 'Cebu City' },
};

const eventPage = () => nextDataPage({ pageProps: { initialData: { data: { event: EVENT } } } });

describe('parseLumaEventHtml', () => {
    it('maps the event on the page', () => {
        const event = parseLumaEventHtml(eventPage());
        expect(event?.name).toBe('AWS Community Day Cebu');
        expect(event?.url).toBe('https://luma.com/h285dxy6');
    });

    it('returns null when the page has no event data', () => {
        expect(parseLumaEventHtml('<html><body>hi</body></html>')).toBeNull();
    });
});

describe('probeLumaEventPage', () => {
    it('reads the title, start time and location from a real event page', async () => {
        const urls = stubFetch(200, eventPage());
        expect(await probeLumaEventPage('https://luma.com/h285dxy6')).toEqual({
            kind: 'parsed',
            fields: {
                name: 'AWS Community Day Cebu',
                start_time: '2026-11-21T01:00:00.000Z',
                location: 'iACADEMY Cebu, Cebu City',
            },
        });
        expect(urls.map((u) => new URL(u).hostname)).toEqual(['luma.com']);
    });

    it('skips an event that is gone', async () => {
        stubFetch(404);
        expect(await probeLumaEventPage('https://luma.com/h285dxy6')).toEqual({
            kind: 'skip',
            reason: 'gone (HTTP 404)',
        });
    });

    it('skips the not-found page Luma serves with HTTP 200', async () => {
        stubFetch(200, nextDataPage({ pageProps: { status: 404, initialData: { data: {} } } }));
        expect(await probeLumaEventPage('https://luma.com/h285dxy6')).toEqual({
            kind: 'skip',
            reason: 'gone (page not found)',
        });
        fetchStub?.restore();
        stubFetch(200, nextDataPage({ pageProps: { initialData: null } }));
        expect(await probeLumaEventPage('https://luma.com/h285dxy6')).toEqual({
            kind: 'skip',
            reason: 'gone (page not found)',
        });
    });

    it('fails on a server error', async () => {
        stubFetch(500);
        await expect(probeLumaEventPage('https://luma.com/h285dxy6')).rejects.toThrow('HTTP 500');
    });

    it('fails when the page has no event data', async () => {
        stubFetch(200, '<html><body>changed layout</body></html>');
        await expect(probeLumaEventPage('https://luma.com/h285dxy6')).rejects.toThrow('no event data on page');
    });

    it('only ever fetches from luma.com', async () => {
        const urls = stubFetch(200, eventPage());
        await probeLumaEventPage('https://evil.example/x').catch(() => {});
        for (const url of urls) expect(new URL(url).hostname).toBe('luma.com');
    });
});
