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
 * Deduplicate by event name, then bucket events into time periods and return
 * the grouped + sorted result. Sorting order mirrors the previous inline logic.
 */
export function groupEventsByPeriod(events: EventFromDB[], timezone = 'Asia/Manila'): GroupedEvents {
    // De-duplicate (case-insensitive name match)
    const unique = new Map<string, EventFromDB>();
    events.forEach((e) => {
        const key = e.name?.toLowerCase?.() || '';
        if (!unique.has(key)) unique.set(key, e);
    });

    const uniqueEvents = [...unique.values()];

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

    // Sort helpers
    const chrono = (a: EventFromDB, b: EventFromDB) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
    const revChrono = (a: EventFromDB, b: EventFromDB) =>
        new Date(b.start_time).getTime() - new Date(a.start_time).getTime();

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
