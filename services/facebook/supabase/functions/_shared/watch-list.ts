// The watch-list listing step of retrieve-and-sync-to-db-events: which page of a
// watched (non-partner) Facebook page the cron reads, and which of its events it
// goes on to scrape.
//
// Logged out, a page's /upcoming_hosted_events carries no event list at all when
// the page has nothing upcoming (and 404s for some pages), which read as "page
// not read" for every quiet page. Its /events tab lists the upcoming events, or
// the past ones when none are upcoming, so a list there proves the page was read.
// (Checked 2026-11-04 on all 25 watched pages: same upcoming events on both URLs
// where a page had any.)
import type { ReadFailure } from '@service/core/supabase/shared/health-checks.ts';
import { scrapeFbEventList } from './fb-event-scraper/index.ts';
import type { ShortEventData } from './fb-event-scraper/types.ts';

/** The events tab for a watched page's slug or numeric id. */
export function watchEventsUrl(path: string): string {
    return `https://www.facebook.com/${path}/events`;
}

/**
 * The watched page's upcoming events, read from its events tab. A tab that lists
 * only past events was still read: it resolves with no events. Throws when the
 * tab has no event list (no events ever, or a page that can't be read).
 */
export async function listWatchedPageEvents(url: string, scrape = scrapeFbEventList): Promise<ShortEventData[]> {
    // No event type: asking for upcoming events rewrites the URL to /upcoming_hosted_events.
    const events = await scrape(url);
    return events.filter((e) => !e.isPast);
}

/** Why a watched page's events tab wasn't read, from the scraper's error message. */
export function classifyWatchListError(message: string): ReadFailure {
    if (/no event data found/i.test(message)) return { code: 'no_event_list', detail: message };
    if (/invalid facebook page event url/i.test(message)) return { code: 'not_found', detail: message };
    return { code: 'fetch_failed', detail: message };
}
