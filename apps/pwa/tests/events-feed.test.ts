import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventFromDB } from '../src/types/database';

const query = vi.hoisted(() => ({ result: { data: [] as unknown[] | null, error: null as unknown } }));

// Every query builder call chains; awaiting the query resolves to `query.result`.
vi.mock('../src/lib/supabase', () => {
    const builder: any = new Proxy(
        {},
        {
            get(_target, prop) {
                if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(query.result);
                return () => builder;
            },
        },
    );
    return { supabase: { from: () => builder } };
});

const { getEventsFeed } = await import('../src/lib/events-feed');

function event(id: number, startTime: string): EventFromDB {
    return { id, name: `Event ${id}`, start_time: startTime, end_time: null, status: 'published' } as unknown as EventFromDB;
}

describe('getEventsFeed', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // Monday 2026-10-19, 10:00 in Manila.
        vi.setSystemTime(new Date('2026-10-19T02:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('counts next-week events as upcoming', async () => {
        // Wednesday of next week, 10:00 in Manila.
        query.result = { data: [event(1, '2026-10-28T02:00:00Z')], error: null };

        const feed = await getEventsFeed();

        expect(feed.events.nextWeek.map((e) => e.id)).toEqual([1]);
        expect(feed.allUpcomingEvents.map((e) => e.id)).toEqual([1]);
        expect(feed.metrics.upcomingCount).toBe(1);
    });

    it('surfaces the Supabase error to the caller', async () => {
        const error = { message: 'connection refused' };
        query.result = { data: null, error };

        await expect(getEventsFeed()).rejects.toBe(error);
    });
});
