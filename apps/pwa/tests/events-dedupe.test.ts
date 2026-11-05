import { describe, expect, it } from 'vitest';
import { dedupeEvents } from '../src/utils/events';

const row = (id: number, name: string, start_time: string) => ({ id, name, start_time });

describe('dedupeEvents', () => {
    it('keeps each date of a series that shares one name', () => {
        const rows = [
            row(3, 'Bitcoin Meetup Cebu', '2026-12-30T11:00:00Z'),
            row(2, 'Bitcoin Meetup Cebu', '2026-12-04T11:00:00Z'),
            row(1, 'Bitcoin Meetup Cebu', '2026-11-06T11:00:00Z'),
        ];

        expect(dedupeEvents(rows).map((e) => e.id)).toEqual([3, 2, 1]);
    });

    it('collapses rows with the same name on the same Manila day, keeping the first', () => {
        const rows = [
            row(1, 'DevXchange', '2026-11-07T02:00:00Z'),
            row(2, 'devxchange ', '2026-11-07T03:00:00Z'),
        ];

        expect(dedupeEvents(rows).map((e) => e.id)).toEqual([1]);
    });

    it('splits days at Manila midnight, not UTC midnight', () => {
        // Same UTC date, but 23:30 Nov 6 and 01:00 Nov 7 in Manila.
        const lateNight = row(1, 'Hack Night', '2026-11-06T15:30:00Z');
        const nextDay = row(2, 'Hack Night', '2026-11-06T17:00:00Z');
        // Different UTC dates, but both on Nov 7 in Manila.
        const morning = row(3, 'Hack Night', '2026-11-06T23:00:00Z');

        expect(dedupeEvents([lateNight, nextDay]).map((e) => e.id)).toEqual([1, 2]);
        expect(dedupeEvents([nextDay, morning]).map((e) => e.id)).toEqual([2]);
    });

    it('never merges unnamed events with each other', () => {
        const rows = [row(1, '', '2026-11-07T02:00:00Z'), { id: 2, name: null, start_time: '2026-11-07T02:00:00Z' }];

        expect(dedupeEvents(rows).map((e) => e.id)).toEqual([1, 2]);
    });
});
