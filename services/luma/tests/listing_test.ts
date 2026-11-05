import { afterEach, describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { type Stub, stub } from 'jsr:@std/testing/mock';
import { listEventsForLumaPath } from '../supabase/functions/_shared/lumautils.ts';
import { nextDataPage, routeFetch } from './helpers.ts';

let fetchStub: Stub<typeof globalThis, Parameters<typeof fetch>, Promise<Response>> | null = null;

function useRoutes(routes: Record<string, () => Response>) {
    fetchStub = stub(globalThis, 'fetch', routeFetch(routes));
}

afterEach(() => {
    fetchStub?.restore();
    fetchStub = null;
});

const html =
    (body: string, status = 200) =>
    () =>
        new Response(body, { status });

describe('listEventsForLumaPath: calendar', () => {
    it('counts a calendar with no upcoming events as read', async () => {
        useRoutes({
            'luma.com/awsugcebu': html(
                nextDataPage({ pageProps: { initialData: { data: { has_upcoming_events: false } } } }),
            ),
        });
        expect(await listEventsForLumaPath('awsugcebu')).toEqual({ pageRead: true, events: [] });
    });

    it('counts a server error as not read, as a failed fetch', async () => {
        useRoutes({ 'luma.com/awsugcebu': html('oops', 500) });
        expect(await listEventsForLumaPath('awsugcebu')).toEqual({
            pageRead: false,
            events: [],
            readError: { code: 'fetch_failed', detail: 'calendar page: HTTP 500' },
        });
    });

    it('counts a page without __NEXT_DATA__ as not read, as an unexpected page', async () => {
        useRoutes({ 'luma.com/awsugcebu': html('<html><body>new layout</body></html>') });
        const listing = await listEventsForLumaPath('awsugcebu');
        expect(listing.pageRead).toBe(false);
        expect(listing.readError?.code).toBe('unexpected_page');
    });

    it('counts a calendar with upcoming events but no event list as not read', async () => {
        useRoutes({
            'luma.com/awsugcebu': html(
                nextDataPage({ pageProps: { initialData: { data: { has_upcoming_events: true } } } }),
            ),
        });
        const listing = await listEventsForLumaPath('awsugcebu');
        expect(listing.pageRead).toBe(false);
        expect(listing.readError?.code).toBe('unexpected_page');
    });

    it('counts a calendar whose event list is present but empty as read', async () => {
        useRoutes({
            'luma.com/awsugcebu': html(nextDataPage({ pageProps: { initialData: { data: { featured_items: [] } } } })),
        });
        expect(await listEventsForLumaPath('awsugcebu')).toEqual({ pageRead: true, events: [] });
    });
});

describe('listEventsForLumaPath: user', () => {
    it('counts a missing user as not read, as not found', async () => {
        useRoutes({
            'luma.com/user/princejohn': html(nextDataPage({ pageProps: { status: 404, initialData: { data: {} } } })),
        });
        const listing = await listEventsForLumaPath('user/princejohn');
        expect(listing.pageRead).toBe(false);
        expect(listing.readError?.code).toBe('not_found');
    });

    it('records a rate-limited event list as rate limited', async () => {
        useRoutes({
            'luma.com/user/princejohn': html(
                nextDataPage({ pageProps: { initialData: { user: { api_id: 'usr-1', name: 'Prince' } } } }),
            ),
            'api2.luma.com/user/profile/events-hosting': () => new Response('slow down', { status: 429 }),
        });
        expect((await listEventsForLumaPath('user/princejohn')).readError?.code).toBe('rate_limited');
    });

    it('counts a user whose event list loaded as read, even when it is empty', async () => {
        useRoutes({
            'luma.com/user/princejohn': html(
                nextDataPage({ pageProps: { initialData: { user: { api_id: 'usr-1', name: 'Prince' } } } }),
            ),
            'api2.luma.com/user/profile/events-hosting': () => Response.json({ entries: [] }),
        });
        expect(await listEventsForLumaPath('user/princejohn')).toEqual({ pageRead: true, events: [] });
    });

    it('counts an event list response without its entries as not read', async () => {
        useRoutes({
            'luma.com/user/princejohn': html(
                nextDataPage({ pageProps: { initialData: { user: { api_id: 'usr-1', name: 'Prince' } } } }),
            ),
            'api2.luma.com/user/profile/events-hosting': () => Response.json({ message: 'Something went wrong' }),
        });
        const listing = await listEventsForLumaPath('user/princejohn');
        expect(listing.pageRead).toBe(false);
        expect(listing.readError?.code).toBe('unexpected_page');
    });
});
