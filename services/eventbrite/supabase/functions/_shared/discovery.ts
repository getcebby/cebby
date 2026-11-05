// Which of a watched organizer's events to import this run (spec
// docs/superpowers/specs/2026-11-05-eventbrite-finding-design.md, "How it works").
// Reads only; the sync imports the URLs this returns.
import type { ReadFailure } from '@service/core/supabase/shared/health-checks.ts';
import { countsForCebby } from '@service/core/supabase/shared/cebu-rule.ts';
import {
    type FetchFn,
    fetchOrganizer,
    fetchSeriesDates,
    isSeriesParent,
    type ListedEvent,
    listOrganizerEvents,
    type SeriesDate,
} from './organizer-api.ts';

/** A series lists at most this many upcoming dates on Cebby… */
export const SERIES_MAX_DATES = 2;
/** …and only dates starting within this many days. One-off events have no limit. */
export const SERIES_HORIZON_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export type Skip = {
    id: string;
    reason: 'cancelled' | 'no_venue' | 'outside_cebu' | 'online_not_cebu_based' | 'lookup_failed';
};

export type ImportPlan =
    | { pageRead: true; urls: string[]; skipped: Skip[] }
    | { pageRead: false; readError: ReadFailure };

/** The first SERIES_MAX_DATES dates that start after `now` and within SERIES_HORIZON_DAYS. */
export function pickSeriesDates(dates: SeriesDate[], now: Date): SeriesDate[] {
    const from = now.getTime();
    const until = from + SERIES_HORIZON_DAYS * DAY_MS;
    return dates
        .filter((d) => {
            const start = Date.parse(d.startUtc);
            return start > from && start <= until;
        })
        .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
        .slice(0, SERIES_MAX_DATES);
}

/** Why a listed event doesn't count for Cebby, or null when it does. */
function skipReason(event: ListedEvent, accountIsCebuBased: boolean): Skip['reason'] | null {
    if (event.isCancelled) return 'cancelled';
    if (event.isOnline) return countsForCebby({ online: true }, accountIsCebuBased) ? null : 'online_not_cebu_based';
    if (!event.venue) return 'no_venue';
    return countsForCebby({ online: false, ...event.venue }, accountIsCebuBased) ? null : 'outside_cebu';
}

const eventUrl = (id: string) => `https://www.eventbrite.com/e/${id}`;

/**
 * Reads one organizer and decides which event pages to import. The organizer
 * counts as read once it exists and its list loads, even an empty one; a bad id
 * is unread (`not_found`), because the list alone can't tell it from a quiet one.
 */
export async function planOrganizerImports(
    account: { account_id: string; is_cebu_based: boolean },
    deps: { fetchFn?: FetchFn; now: Date },
): Promise<ImportPlan> {
    const fetchFn = deps.fetchFn ?? fetch;
    const organizer = await fetchOrganizer(account.account_id, fetchFn);
    if (!organizer.ok) return { pageRead: false, readError: organizer.failure };
    const listing = await listOrganizerEvents(account.account_id, fetchFn);
    if (!listing.ok) return { pageRead: false, readError: listing.failure };

    const urls: string[] = [];
    const skipped: Skip[] = [];
    const add = (url: string) => {
        if (!urls.includes(url)) urls.push(url);
    };
    for (const event of listing.events) {
        const reason = skipReason(event, account.is_cebu_based);
        if (reason) {
            skipped.push({ id: event.id, reason });
            continue;
        }
        try {
            if (await isSeriesParent(event.id, fetchFn)) {
                for (const date of pickSeriesDates(await fetchSeriesDates(event.id, fetchFn), deps.now)) {
                    add(eventUrl(date.id));
                }
            } else {
                add(eventUrl(event.id));
            }
        } catch (error) {
            console.warn(`[eventbrite-cron] series lookup failed for event ${event.id}:`, error);
            skipped.push({ id: event.id, reason: 'lookup_failed' });
        }
    }
    return { pageRead: true, urls, skipped };
}
