import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { classifyWatchListError, listWatchedPageEvents, watchEventsUrl } from '../supabase/functions/_shared/watch-list.ts';
import { getEventListFromPageOrProfile } from '../supabase/functions/_shared/fb-event-scraper/event-list-parser.ts';
import { EventType } from '../supabase/functions/_shared/fb-event-scraper/types.ts';
import type { ShortEventData } from '../supabase/functions/_shared/fb-event-scraper/types.ts';
import { validateAndFormatEventPageUrl } from '../supabase/functions/_shared/fb-event-scraper/url.ts';

/** A page's events tab as Facebook serves it logged-out: a "collection" of event cards. */
function eventsTab(events: { id: string; isPast: boolean }[]): string {
    const edges = events.map((e) => ({
        node: {
            node: {
                id: e.id,
                name: `Event ${e.id}`,
                url: `https://www.facebook.com/events/${e.id}/`,
                day_time_sentence: 'Sat, Nov 8',
                is_canceled: false,
            },
            actions_renderer: { event: { is_past: e.isPast } },
        },
    }));
    return `<script>${JSON.stringify({ collection: { pageItems: { edges } } })}</script>`;
}

/** A scrape that parses `html` like the real one and records how it was called. */
function fakeScrape(html: string) {
    const calls: { url: string; type?: EventType }[] = [];
    // Async like the real scrape, so a page without a list rejects rather than throws.
    const scrape = async (url: string, type?: EventType): Promise<ShortEventData[]> => {
        calls.push({ url, type });
        return await Promise.resolve().then(() => getEventListFromPageOrProfile(html));
    };
    return { calls, scrape };
}

describe('watchEventsUrl', () => {
    it("reads the page's events tab, which still lists events for logged-out visitors", () => {
        // Logged out, /upcoming_hosted_events carries no list when a page has nothing
        // upcoming (and 404s for some pages); /events lists upcoming events, or the
        // past ones when none are upcoming.
        expect(watchEventsUrl('gdgcebuorg')).toBe('https://www.facebook.com/gdgcebuorg/events');
        expect(watchEventsUrl('61565584603952')).toBe('https://www.facebook.com/61565584603952/events');
    });

    it('stays the events tab through the scraper URL check', () => {
        expect(validateAndFormatEventPageUrl(watchEventsUrl('gdgcebuorg'))).toBe(
            'https://www.facebook.com/gdgcebuorg/events?_fb_noscript=1',
        );
    });
});

describe('listWatchedPageEvents', () => {
    it('keeps only the upcoming events', async () => {
        const { scrape } = fakeScrape(eventsTab([{ id: '1', isPast: false }, { id: '2', isPast: true }]));
        const events = await listWatchedPageEvents(watchEventsUrl('gdgcebuorg'), scrape);
        expect(events.map((e) => e.id)).toEqual(['1']);
    });

    it('reads a page with only past events as read, with nothing upcoming', async () => {
        const { scrape } = fakeScrape(eventsTab([{ id: '2', isPast: true }, { id: '3', isPast: true }]));
        expect(await listWatchedPageEvents(watchEventsUrl('gdgcebuorg'), scrape)).toEqual([]);
    });

    it('asks for the tab as is, since asking for upcoming events switches to the upcoming listing', async () => {
        const { calls, scrape } = fakeScrape(eventsTab([]));
        await listWatchedPageEvents(watchEventsUrl('gdgcebuorg'), scrape);
        expect(calls).toEqual([{ url: 'https://www.facebook.com/gdgcebuorg/events', type: undefined }]);
    });

    it('fails, so the page counts as unread, when the tab has no event list at all', async () => {
        const { scrape } = fakeScrape('<html><body>Log in to Facebook</body></html>');
        await expect(listWatchedPageEvents(watchEventsUrl('gdgcebuorg'), scrape)).rejects.toThrow(
            'No event data found',
        );
    });
});

describe('classifyWatchListError', () => {
    it('reads a page with no event list as no_event_list', () => {
        const message = 'No event data found, please verify that your URL is correct and the events are accessible';
        expect(classifyWatchListError(message)).toEqual({ code: 'no_event_list', detail: message });
    });

    it('reads a bad page address as not_found', () => {
        expect(classifyWatchListError('Invalid Facebook page event URL').code).toBe('not_found');
    });

    it('reads anything else as a failed fetch', () => {
        expect(classifyWatchListError('Error fetching event, make sure your URL is correct').code).toBe('fetch_failed');
    });
});
