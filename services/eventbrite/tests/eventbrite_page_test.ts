import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import {
    eventbriteHtmlToText,
    parseEventbriteEventPage,
    toIngestEvent,
} from '../supabase/functions/_shared/eventbriteutils.ts';

const fixture = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/${name}.html`, import.meta.url));
const occurrenceHtml = fixture('bitcoin-meetup-occurrence');
const seriesParentHtml = fixture('bitcoin-meetup-series-parent');
const occurrenceUrl = 'https://www.eventbrite.com/e/2002279263176';

/** The same page without __NEXT_DATA__, to exercise the schema.org fallback. */
const withoutNextData = (html: string) => html.replace(/<script id="__NEXT_DATA__"[\s\S]*?<\/script>/, '');

describe('parseEventbriteEventPage', () => {
    it('normalizes a single date of a series from __NEXT_DATA__', () => {
        const page = parseEventbriteEventPage(occurrenceHtml, occurrenceUrl);
        if (page?.kind !== 'event') throw new Error(`expected an event, got ${page?.kind}`);
        const event = page.event;

        expect(event.eventbrite_id).toBe('2002279263176');
        expect(event.url).toBe(occurrenceUrl);
        expect(event.name).toBe('Bitcoin Meetup Cebu');
        expect(event.start_time).toBe('2026-12-30T11:00:00.000Z');
        expect(event.end_time).toBe('2026-12-30T12:30:00.000Z');
        expect(event.timezone).toBe('Asia/Makassar');
        expect(event.is_free).toBe(true);
        expect(event.organizer).toEqual({
            account_id: '110850996031',
            name: 'Code Orange Dev School',
            path: 'code-orange-dev-school-110850996031',
            avatar: null,
        });
        expect(event.venue).toEqual({
            name: 'CoffeeBay',
            address: 'Abad Street, Cebu City, Central Visayas 6000',
            city: 'Cebu City',
            region: 'Central Visayas',
            country: 'PH',
            lat: 10.3291362,
            lng: 123.905821,
        });
        expect(event.location).toBe('CoffeeBay, Abad Street, Cebu City, Central Visayas 6000');
        expect(event.location_details).toEqual({ latitude: 10.3291362, longitude: 123.905821 });
        expect(event.cover_photo).toMatch(/^https:\/\/img\.evbuc\.com\//);
        expect(event.description).toContain('Curious to learn how to run a bitcoin node');
        expect(event.description).toContain('• Self-custody');
        expect(event.description).not.toContain('<');
    });

    it('flags the series parent instead of returning a years-long event', () => {
        expect(parseEventbriteEventPage(seriesParentHtml, 'https://www.eventbrite.com/e/2002279245122')).toEqual({
            kind: 'series_parent',
            seriesId: '2002279245122',
            name: 'Bitcoin Meetup Cebu',
        });
    });

    it('falls back to the schema.org Event block when __NEXT_DATA__ is missing', () => {
        const page = parseEventbriteEventPage(withoutNextData(occurrenceHtml), occurrenceUrl);
        if (page?.kind !== 'event') throw new Error(`expected an event, got ${page?.kind}`);

        expect(page.event.eventbrite_id).toBe('2002279263176');
        expect(page.event.start_time).toBe('2026-12-30T11:00:00.000Z');
        expect(page.event.end_time).toBe('2026-12-30T12:30:00.000Z');
        expect(page.event.organizer.account_id).toBe('110850996031');
        expect(page.event.location).toBe('CoffeeBay, Abad Street, Cebu City, Central Visayas 6000');
    });

    it('treats a schema.org-only page spanning more than a week as a series parent', () => {
        const page = parseEventbriteEventPage(withoutNextData(seriesParentHtml), 'https://www.eventbrite.com/e/2002279245122');
        expect(page?.kind).toBe('series_parent');
    });

    it('returns null when the page has no event data', () => {
        expect(parseEventbriteEventPage('<html><head></head><body>Not found</body></html>', occurrenceUrl)).toBeNull();
    });
});

describe('eventbriteHtmlToText', () => {
    it('keeps paragraphs and list items readable as plain text', () => {
        expect(eventbriteHtmlToText('<p>Hi &amp; welcome</p><ul><li>One</li><li>Two</li></ul><p>Bye<br>now</p>'))
            .toBe('Hi & welcome\n\n• One\n• Two\n\nBye\nnow');
    });
});

describe('toIngestEvent', () => {
    it('maps an Eventbrite event to the shared ingest shape', () => {
        const page = parseEventbriteEventPage(occurrenceHtml, occurrenceUrl);
        if (page?.kind !== 'event') throw new Error('expected an event');
        const ingest = toIngestEvent(page.event, '110850996031');

        expect(ingest).toMatchObject({
            name: 'Bitcoin Meetup Cebu',
            start_time: '2026-12-30T11:00:00.000Z',
            end_time: '2026-12-30T12:30:00.000Z',
            format: 'in_person',
            city: 'Cebu City',
            region: 'Central Visayas',
            country: 'PH',
            source: 'eventbrite',
            source_id: '2002279263176',
            source_url: occurrenceUrl,
            ingest_kind: 'public_scrape',
            organizers: [{ account_id: '110850996031', role: 'presenter' }],
        });
    });
});
