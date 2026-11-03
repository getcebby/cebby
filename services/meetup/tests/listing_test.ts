import { afterEach, describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { type Stub, stub } from 'jsr:@std/testing/mock';
import { listEventsForMeetupGroup } from '../supabase/functions/_shared/meetuputils.ts';
import { GROUP_URLNAME, nextDataPage } from './helpers.ts';

let fetchStub: Stub<typeof globalThis, Parameters<typeof fetch>, Promise<Response>> | null = null;

function stubFetch(status: number, body = '') {
    fetchStub = stub(globalThis, 'fetch', () => Promise.resolve(new Response(body, { status })));
}

afterEach(() => {
    fetchStub?.restore();
    fetchStub = null;
});

describe('listEventsForMeetupGroup', () => {
    it('counts a group page with no events as read', async () => {
        stubFetch(
            200,
            nextDataPage({ __APOLLO_STATE__: { 'Group:38001': { name: 'AWS SBG NU Cebu', urlname: GROUP_URLNAME } } }),
        );
        expect(await listEventsForMeetupGroup(GROUP_URLNAME)).toEqual({ pageRead: true, events: [] });
    });

    it('counts a blocked request as not read', async () => {
        stubFetch(403, 'Forbidden');
        expect(await listEventsForMeetupGroup(GROUP_URLNAME)).toEqual({ pageRead: false, events: [] });
    });

    it('counts a page without __NEXT_DATA__ as not read', async () => {
        stubFetch(200, '<html><body>new layout</body></html>');
        expect((await listEventsForMeetupGroup(GROUP_URLNAME)).pageRead).toBe(false);
    });
});
