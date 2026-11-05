import { formatInTimeZone } from 'date-fns-tz';
import {
    getDateInTimezone,
    getEndOfMonth,
    getEndOfNextWeek,
    getEndOfWeek,
    getStartOfMonth,
    getStartOfNextWeek,
    getStartOfWeek,
} from './date';

import type { EventFromDB } from '../types/database';

export interface GroupedEvents {
    happening: EventFromDB[];
    today: EventFromDB[];
    tomorrow: EventFromDB[];
    thisWeek: EventFromDB[];
    nextWeek: EventFromDB[];
    thisMonth: EventFromDB[];
    nextMonth: EventFromDB[];
    later: EventFromDB[];
    recent: EventFromDB[];
    past: EventFromDB[];
}

/**
 * Drop rows that share a name and a local calendar day, keeping the first.
 *
 * Ingest already merges one event seen on several platforms into a single row,
 * so this is only a safety net for same-day copies it missed. The day is part
 * of the key because a series (a monthly meetup on Eventbrite, Meetup or Luma)
 * reuses one name for every date, and each date is its own event.
 */
export function dedupeEvents<T extends { name?: string | null; start_time?: string | null }>(
    events: T[],
    timezone = 'Asia/Manila',
): T[] {
    const seen = new Set<string>();
    return events.filter((event) => {
        const name = event.name?.trim().toLowerCase();
        if (!name || !event.start_time) return true;
        const key = `${name}|${formatInTimeZone(new Date(event.start_time), timezone, 'yyyy-MM-dd')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Deduplicate same-day copies, then bucket events into time periods and return
 * the grouped + sorted result. Sorting order mirrors the previous inline logic.
 */
export function groupEventsByPeriod(events: EventFromDB[], timezone = 'Asia/Manila'): GroupedEvents {
    const uniqueEvents = dedupeEvents(events, timezone);

    const now = getDateInTimezone(new Date(), timezone);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const tomorrow = getDateInTimezone(new Date(today), timezone);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const thirtyDaysAgo = getDateInTimezone(new Date(today), timezone);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const buckets: GroupedEvents = {
        happening: [],
        today: [],
        tomorrow: [],
        thisWeek: [],
        nextWeek: [],
        thisMonth: [],
        nextMonth: [],
        later: [],
        recent: [],
        past: [],
    };

    uniqueEvents.forEach((event) => {
        const eventStart = getDateInTimezone(new Date(event.start_time), timezone);
        const eventEnd = event.end_time
            ? getDateInTimezone(new Date(event.end_time), timezone)
            : getDateInTimezone(new Date(eventStart.getTime() + 4 * 60 * 60 * 1000), timezone);

        if (eventStart <= now && now <= eventEnd) {
            buckets.happening.push(event);
            return;
        }

        if (eventStart > now) {
            const startOfWeek = getStartOfWeek(today, timezone);
            const endOfWeek = getEndOfWeek(today, timezone);
            const startOfNextWeek = getStartOfNextWeek(today, timezone);
            const endOfNextWeek = getEndOfNextWeek(today, timezone);
            const startOfMonth = getStartOfMonth(today, timezone);
            const endOfMonth = getEndOfMonth(today, timezone);

            const nextMonth = getDateInTimezone(new Date(today), timezone);
            nextMonth.setDate(1);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            nextMonth.setHours(0, 0, 0, 0);

            if (eventStart.toDateString() === today.toDateString()) {
                buckets.today.push(event);
            } else if (eventStart.toDateString() === tomorrow.toDateString()) {
                buckets.tomorrow.push(event);
            } else if (eventStart >= startOfWeek && eventStart <= endOfWeek) {
                buckets.thisWeek.push(event);
            } else if (eventStart >= startOfNextWeek && eventStart <= endOfNextWeek) {
                buckets.nextWeek.push(event);
            } else if (eventStart >= startOfMonth && eventStart <= endOfMonth) {
                buckets.thisMonth.push(event);
            } else if (eventStart >= nextMonth) {
                buckets.nextMonth.push(event);
            } else {
                buckets.later.push(event);
            }
        } else if (eventStart >= thirtyDaysAgo) {
            buckets.recent.push(event);
        } else {
            buckets.past.push(event);
        }
    });

    // Sort helpers — featured first, then chronological within each featured tier
    const chrono = (a: EventFromDB, b: EventFromDB) => {
        if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
        return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
    };
    const revChrono = (a: EventFromDB, b: EventFromDB) => {
        if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
        return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
    };

    buckets.happening.sort(revChrono);
    buckets.today.sort(chrono);
    buckets.tomorrow.sort(chrono);
    buckets.thisWeek.sort(chrono);
    buckets.nextWeek.sort(chrono);
    buckets.thisMonth.sort(chrono);
    buckets.nextMonth.sort(chrono);
    buckets.later.sort(chrono);
    buckets.recent.sort(revChrono);
    buckets.past.sort(revChrono);

    return buckets;
}
