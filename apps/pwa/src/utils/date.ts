import { format, isSameDay, isThisWeek } from 'date-fns';

export function getLongFormattedDate(date: string) {
    try {
        return new Intl.DateTimeFormat('en-PH', {
            timeZone: 'Asia/Manila',
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        }).format(new Date(date));
    } catch (err) {
        console.log('Unable to format date properly: ', err);
        return '';
    }
}

export function getFormattedTime(date: string) {
    try {
        return new Intl.DateTimeFormat('en-PH', {
            timeZone: 'Asia/Manila',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        }).format(new Date(date));
    } catch (err) {
        console.log('Unable to format and get time properly: ', err);
        return '';
    }
}

export function getEventTimeDisplay(startDate: string, endDate?: string, timezone: string = 'Asia/Manila') {
    try {
        const start = new Date(startDate);
        const startInTz = new Date(start.toLocaleString('en-US', { timeZone: timezone }));

        if (!endDate) {
            // Format: Sunday, November 24, 2024 at 10:30 AM
            return `${format(startInTz, 'EEEE, MMMM d, yyyy')} at ${format(startInTz, 'h:mm a')}`;
        }

        const end = new Date(endDate);
        const endInTz = new Date(end.toLocaleString('en-US', { timeZone: timezone }));

        // If same day, show: Saturday, November 16 at 2:30 PM - 4:45 PM
        if (isSameDay(startInTz, endInTz)) {
            // If this week, show shorter format
            if (isThisWeek(startInTz)) {
                return `${format(startInTz, 'EEEE')} at ${format(startInTz, 'h:mm a')} - ${format(endInTz, 'h:mm a')}`;
            }
            return `${format(startInTz, 'EEEE, MMMM d')} at ${format(startInTz, 'h:mm a')} - ${format(endInTz, 'h:mm a')}`;
        }

        // Different days, always show full format for both dates
        return `${format(startInTz, 'EEEE, MMMM d, yyyy')} at ${format(startInTz, 'h:mm a')} - ${format(endInTz, 'EEEE, MMMM d, yyyy')} at ${format(endInTz, 'h:mm a')}`;
    } catch (err) {
        console.log('Unable to format event time display: ', err);
        return '';
    }
}

// -------------------------------------------------------------
// Additional helpers for timezone-aware date manipulation
// These are reused by the events page and other utilities so
// we keep them colocated with the other date helpers.
// -------------------------------------------------------------

export const TIMEZONE = 'Asia/Manila';

/**
 * Return a new Date adjusted to the given timezone (defaults to Asia/Manila).
 */
export function getDateInTimezone(date: Date, timezone: string = TIMEZONE): Date {
    return new Date(date.toLocaleString('en-US', { timeZone: timezone }));
}

export function getStartOfWeek(date: Date, timezone: string = TIMEZONE): Date {
    const d = getDateInTimezone(new Date(date), timezone);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // 0 (Sun) -> -6 so week starts Monday
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

export function getEndOfWeek(date: Date, timezone: string = TIMEZONE): Date {
    const d = getStartOfWeek(date, timezone);
    d.setDate(d.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
}

export function getStartOfNextWeek(date: Date, timezone: string = TIMEZONE): Date {
    const startOfWeek = getStartOfWeek(date, timezone);
    const next = getDateInTimezone(new Date(startOfWeek), timezone);
    next.setDate(next.getDate() + 7);
    next.setHours(0, 0, 0, 0);
    return next;
}

export function getEndOfNextWeek(date: Date, timezone: string = TIMEZONE): Date {
    const start = getStartOfNextWeek(date, timezone);
    const end = getDateInTimezone(new Date(start), timezone);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end;
}

export function getStartOfMonth(date: Date, timezone: string = TIMEZONE): Date {
    const d = getDateInTimezone(new Date(date), timezone);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
}

export function getEndOfMonth(date: Date, timezone: string = TIMEZONE): Date {
    const d = getDateInTimezone(new Date(date), timezone);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    d.setHours(23, 59, 59, 999);
    return d;
}
