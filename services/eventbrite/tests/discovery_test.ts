import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { pickSeriesDates, planOrganizerImports } from '../supabase/functions/_shared/discovery.ts';

const FIXTURES = 'tests/fixtures/organizer';
const read = (name: string) => Deno.readTextFile(`${FIXTURES}/${name}`);
const now = new Date((await read('CAPTURED_AT.txt')).trim());

const json = (body: string, status = 200) =>
    new Response(body, { status, headers: { 'Content-Type': 'application/json' } });

const codeOrange = { account_id: '110850996031', is_cebu_based: false };
const BITCOIN_MEETUP_CEBU = '2002279245122';
const eventUrl = (id: string) => `https://www.eventbrite.com/e/${id}`;

/**
 * Eventbrite as captured on CAPTURED_AT: organizer `id` exists, lists `events`
 * (default: Code Orange's real list), and every event is a one-off except
 * Bitcoin Meetup Cebu, whose dates come from the captured series fixture.
 * `overrides` replace a URL-substring route. Records every URL asked for.
 */
async function eventbrite(opts: { events?: string; overrides?: [string, () => Response][] } = {}) {
    const organizer = await read('code-orange-organizer.json');
    const events = opts.events ?? await read('code-orange-events.json');
    const parent = await read('series-parent-event.json');
    const oneOff = await read('one-off-event.json');
    const dates = await read('bitcoin-meetup-series-dates.json');
    const routes: [string, () => Response][] = [
        ...(opts.overrides ?? []),
        ['/events/?page=', () => json(events)],
        [`/series/${BITCOIN_MEETUP_CEBU}/events/`, () => json(dates)],
        [`/api/v3/events/${BITCOIN_MEETUP_CEBU}/`, () => json(parent)],
        ['/api/v3/events/', () => json(oneOff)],
        ['/api/v3/organizers/', () => json(organizer)],
    ];
    const calls: string[] = [];
    const fetchFn = (url: string) => {
        calls.push(url);
        const route = routes.find(([part]) => url.includes(part));
        if (!route) throw new Error(`unexpected fetch ${url}`);
        return Promise.resolve(route[1]());
    };
    return { calls, fetchFn };
}

const listed = (events: Record<string, unknown>[]) => JSON.stringify({ events, hasMore: false, total: events.length });
const cebuVenue = { address: { city: 'Cebu City', region: 'Central Visayas', country: 'PH' } };

describe('pickSeriesDates', () => {
    const at = (id: string, startUtc: string) => ({ id, startUtc });
    const nov5 = new Date('2026-11-05T00:00:00Z');

    it('keeps the next 2 dates within 60 days', () => {
        const dates = [
            at('nov6', '2026-11-06T11:00:00Z'),
            at('dec4', '2026-12-04T11:00:00Z'),
            at('dec30', '2026-12-30T11:00:00Z'),
        ];
        expect(pickSeriesDates(dates, nov5).map((d) => d.id)).toEqual(['nov6', 'dec4']);
    });

    it('keeps nothing when every date is more than 60 days away', () => {
        expect(pickSeriesDates([at('feb', '2027-02-05T11:00:00Z')], nov5)).toEqual([]);
    });

    it('leaves out dates that have already started', () => {
        const dates = [at('past', '2026-11-04T11:00:00Z'), at('nov6', '2026-11-06T11:00:00Z')];
        expect(pickSeriesDates(dates, nov5).map((d) => d.id)).toEqual(['nov6']);
    });
});

describe('planOrganizerImports', () => {
    it("imports only Code Orange's Cebu meetup, as its next 2 dates", async () => {
        const { calls, fetchFn } = await eventbrite();
        const plan = await planOrganizerImports(codeOrange, { fetchFn, now });
        if (!plan.pageRead) throw new Error('expected the organizer to be read');
        // Captured series: Nov 6 and Dec 4 are the first 2 dates after CAPTURED_AT within 60 days.
        expect(plan.urls).toEqual([eventUrl('2004210346097'), eventUrl('2004210347100')]);

        const events = JSON.parse(await read('code-orange-events.json')).events as Record<string, any>[];
        const reasonOf = (id: string) => plan.skipped.find((s) => s.id === id)?.reason;
        for (const e of events.filter((e) => e.is_online_event)) expect(reasonOf(e.id)).toBe('online_not_cebu_based');
        for (const e of events.filter((e) => e.primary_venue?.address?.country === 'ID')) {
            expect(reasonOf(e.id)).toBe('outside_cebu');
        }
        // Series lookups only for events that passed the rule.
        expect(calls.filter((u) => u.includes('/api/v3/events/'))).toEqual([
            `https://www.eventbrite.com/api/v3/events/${BITCOIN_MEETUP_CEBU}/`,
        ]);
    });

    it("keeps a Cebu-based organizer's online events too", async () => {
        const { fetchFn } = await eventbrite();
        const plan = await planOrganizerImports({ ...codeOrange, is_cebu_based: true }, { fetchFn, now });
        if (!plan.pageRead) throw new Error('expected the organizer to be read');
        const events = JSON.parse(await read('code-orange-events.json')).events as Record<string, any>[];
        for (const e of events.filter((e) => e.is_online_event)) expect(plan.urls).toContain(eventUrl(e.id));
        expect(plan.urls).toContain(eventUrl('2004210346097'));
        expect(plan.skipped.every((s) => s.reason === 'outside_cebu')).toBe(true);
    });

    it('skips cancelled events and in-person events without a venue', async () => {
        const events = listed([
            { id: '1', name: 'Cancelled', is_online_event: false, is_cancelled: true, primary_venue: cebuVenue },
            { id: '2', name: 'Nowhere', is_online_event: false, is_cancelled: false },
        ]);
        const { fetchFn } = await eventbrite({ events });
        const plan = await planOrganizerImports(codeOrange, { fetchFn, now });
        expect(plan).toEqual({
            pageRead: true,
            urls: [],
            skipped: [{ id: '1', reason: 'cancelled' }, { id: '2', reason: 'no_venue' }],
        });
    });

    it('imports a one-off Cebu event however far ahead it is', async () => {
        const events = listed([
            { id: '777', name: 'Conference', start_date: '2027-04-10', is_online_event: false, primary_venue: cebuVenue },
        ]);
        const { fetchFn } = await eventbrite({ events });
        const plan = await planOrganizerImports(codeOrange, { fetchFn, now });
        expect(plan).toEqual({ pageRead: true, urls: [eventUrl('777')], skipped: [] });
    });

    it('reads a quiet organizer as read, with nothing to import', async () => {
        const { fetchFn } = await eventbrite({ events: await read('wtm-cebu-events.json') });
        const plan = await planOrganizerImports({ account_id: '109571894561', is_cebu_based: true }, { fetchFn, now });
        expect(plan).toEqual({ pageRead: true, urls: [], skipped: [] });
    });

    it("reports an organizer that doesn't exist as unread, without listing its events", async () => {
        const notFound = await read('organizer-404.json');
        const { calls, fetchFn } = await eventbrite({ overrides: [['/api/v3/organizers/', () => json(notFound, 404)]] });
        const plan = await planOrganizerImports({ account_id: '99999999999', is_cebu_based: false }, { fetchFn, now });
        expect(plan.pageRead ? null : plan.readError.code).toBe('not_found');
        expect(calls.some((u) => u.includes('/events/'))).toBe(false);
    });

    it("skips an event whose series lookup fails, and the organizer still counts as read", async () => {
        const { fetchFn } = await eventbrite({
            overrides: [[`/api/v3/events/${BITCOIN_MEETUP_CEBU}/`, () => new Response('down', { status: 503 })]],
        });
        const plan = await planOrganizerImports(codeOrange, { fetchFn, now });
        if (!plan.pageRead) throw new Error('expected the organizer to be read');
        expect(plan.urls).toEqual([]);
        expect(plan.skipped.find((s) => s.id === BITCOIN_MEETUP_CEBU)?.reason).toBe('lookup_failed');
    });
});
