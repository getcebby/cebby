import { afterEach, describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { type Stub, stub } from 'jsr:@std/testing/mock';
import { fetchGraphEvents } from '../supabase/functions/_shared/graph-events.ts';

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
