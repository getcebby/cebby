import { describe, expect, it } from 'vitest';
import { parseEventbriteOrganizerInput, resolveEventbriteOrganizer } from '../src/lib/eventbrite-organizer';

describe('parseEventbriteOrganizerInput', () => {
    it('reads an organizer page link', () => {
        expect(parseEventbriteOrganizerInput('https://www.eventbrite.com/o/code-orange-dev-school-110850996031')).toEqual({
            kind: 'organizer',
            organizerId: '110850996031',
            path: 'code-orange-dev-school-110850996031',
        });
    });

    it('reads a bare organizer id', () => {
        expect(parseEventbriteOrganizerInput(' 110850996031 ')).toEqual({
            kind: 'organizer',
            organizerId: '110850996031',
            path: null,
        });
    });

    it('reads an event link, whose organizer gets watched', () => {
        expect(parseEventbriteOrganizerInput('https://www.eventbrite.com/e/bitcoin-meetup-cebu-tickets-2004210346097')).toEqual({
            kind: 'event',
            eventId: '2004210346097',
        });
    });

    it('accepts a link without https:// and on a country site', () => {
        expect(parseEventbriteOrganizerInput('eventbrite.com.au/o/some-org-123456789')).toEqual({
            kind: 'organizer',
            organizerId: '123456789',
            path: 'some-org-123456789',
        });
    });

    it('rejects anything else', () => {
        expect(parseEventbriteOrganizerInput('')).toHaveProperty('error');
        expect(parseEventbriteOrganizerInput('https://www.facebook.com/x')).toHaveProperty('error');
        expect(parseEventbriteOrganizerInput('https://eventbrite.attacker.example/o/x-123456789')).toHaveProperty('error');
        expect(parseEventbriteOrganizerInput('https://www.eventbrite.com/d/philippines--cebu/events/')).toHaveProperty('error');
    });
});

/** A fetch that answers JSON by URL substring and records the URLs it was asked for. */
function fakeFetch(routes: Record<string, [number, unknown]>) {
    const calls: string[] = [];
    const fetchFn = async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        const key = Object.keys(routes).find((part) => url.includes(part));
        if (!key) throw new Error(`unexpected fetch ${url}`);
        const [status, body] = routes[key];
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    };
    return { calls, fetchFn: fetchFn as typeof fetch };
}

const codeOrange = {
    id: '110850996031',
    name: 'Code Orange Dev School',
    url: 'https://www.eventbrite.com/o/code-orange-dev-school-110850996031',
};

describe('resolveEventbriteOrganizer', () => {
    it("names an organizer from Eventbrite's organizer record", async () => {
        const { calls, fetchFn } = fakeFetch({ '/api/v3/organizers/110850996031/': [200, codeOrange] });
        const input = parseEventbriteOrganizerInput('110850996031');
        expect(await resolveEventbriteOrganizer(input, fetchFn)).toEqual({
            organizerId: '110850996031',
            name: 'Code Orange Dev School',
            path: 'code-orange-dev-school-110850996031',
        });
        expect(calls).toEqual(['https://www.eventbrite.com/api/v3/organizers/110850996031/']);
    });

    it("finds an event's organizer, then names it", async () => {
        const { calls, fetchFn } = fakeFetch({
            '/api/v3/events/2004210346097/': [200, { id: '2004210346097', organizer_id: '110850996031' }],
            '/api/v3/organizers/110850996031/': [200, codeOrange],
        });
        const input = parseEventbriteOrganizerInput('https://www.eventbrite.com/e/2004210346097');
        expect(await resolveEventbriteOrganizer(input, fetchFn)).toMatchObject({ organizerId: '110850996031' });
        expect(calls).toEqual([
            'https://www.eventbrite.com/api/v3/events/2004210346097/',
            'https://www.eventbrite.com/api/v3/organizers/110850996031/',
        ]);
    });

    it("says so when the organizer doesn't exist", async () => {
        const { fetchFn } = fakeFetch({ '/api/v3/organizers/': [404, { error: 'NOT_FOUND' }] });
        const result = await resolveEventbriteOrganizer(parseEventbriteOrganizerInput('99999999999'), fetchFn);
        expect(result).toEqual({ error: 'No Eventbrite organizer with id 99999999999.' });
    });

    it('passes a parse error through without calling Eventbrite', async () => {
        const { calls, fetchFn } = fakeFetch({});
        expect(await resolveEventbriteOrganizer({ error: 'bad' }, fetchFn)).toEqual({ error: 'bad' });
        expect(calls).toEqual([]);
    });
});
