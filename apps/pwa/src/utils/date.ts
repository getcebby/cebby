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
