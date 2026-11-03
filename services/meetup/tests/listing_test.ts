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

// A group's events page as Meetup serves it: the upcoming list (with edges, empty when there are
// none) beside connections that carry only a count, like the past-events total.
const UPCOMING = 'events({"filter":{"afterDateTime":"2026-11-03T09:31:02.677Z","status":["ACTIVE","PAST","CANCELLED"]},"first":3})';
const COUNT_ONLY = {
    'events({"filter":{"status":["DRAFT"]},"first":1})': { totalCount: 0 },
    'events({"filter":{"status":["PAST"]},"first":1})': { totalCount: 82 },
};

function groupPage(connections: Record<string, unknown>): string {
    return nextDataPage({
        __APOLLO_STATE__: { 'Group:38001': { name: 'AWS SBG NU Cebu', urlname: GROUP_URLNAME, ...connections } },
    });
}

describe('listEventsForMeetupGroup', () => {
    it('counts a group page with no events as read', async () => {
        stubFetch(200, groupPage({ [UPCOMING]: { totalCount: 0, pageInfo: {}, edges: [] }, ...COUNT_ONLY }));
        expect(await listEventsForMeetupGroup(GROUP_URLNAME)).toEqual({ pageRead: true, events: [] });
    });

    it('counts a group page whose event lists carry only counts as not read', async () => {
        stubFetch(200, groupPage({ [UPCOMING]: { totalCount: 1 }, ...COUNT_ONLY }));
        expect(await listEventsForMeetupGroup(GROUP_URLNAME)).toEqual({ pageRead: false, events: [] });
    });

    it('counts a blocked request as not read', async () => {
        stubFetch(403, 'Forbidden');
        expect(await listEventsForMeetupGroup(GROUP_URLNAME)).toEqual({ pageRead: false, events: [] });
    });

    it('counts Apollo state without the group itself as not read', async () => {
        stubFetch(200, nextDataPage({ __APOLLO_STATE__: { ROOT_QUERY: { __typename: 'Query' } } }));
        expect(await listEventsForMeetupGroup(GROUP_URLNAME)).toEqual({ pageRead: false, events: [] });
    });

    it('counts a page without __NEXT_DATA__ as not read', async () => {
        stubFetch(200, '<html><body>new layout</body></html>');
        expect((await listEventsForMeetupGroup(GROUP_URLNAME)).pageRead).toBe(false);
    });
});
