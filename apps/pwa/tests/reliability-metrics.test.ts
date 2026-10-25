import { describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown } }));

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

const { GET } = await import('../src/pages/api/reliability-metrics');

describe('GET /api/reliability-metrics', () => {
    it('returns every column of the event_reliability_metrics view, including partner counts', async () => {
        // One row as the view returns it: 40 upcoming events, percents rounded to 1 decimal.
        query.result = {
            data: {
                generated_at: '2026-10-25T08:00:00+00:00',
                total_upcoming_events: 40,
                sourced_upcoming_events: 38,
                multi_source_upcoming_events: 11,
                partner_upcoming_events: 6,
                trusted_organizer_upcoming_events: 4,
                checked_24h_upcoming_events: 30,
                no_source_upcoming_events: 2,
                latest_checked_at: '2026-10-25T07:45:00+00:00',
                sourced_percent: 95.0,
                multi_source_percent: 27.5,
                partner_percent: 15.0,
                trusted_organizer_percent: 10.0,
                checked_24h_percent: 75.0,
            },
            error: null,
        };

        const response = await GET({} as any);
        const body = await response.json();

        expect(body).toEqual({
            available: true,
            metrics: {
                generated_at: '2026-10-25T08:00:00+00:00',
                latest_checked_at: '2026-10-25T07:45:00+00:00',
                total_upcoming_events: 40,
                sourced_upcoming_events: 38,
                sourced_percent: 95,
                multi_source_upcoming_events: 11,
                multi_source_percent: 27.5,
                partner_upcoming_events: 6,
                partner_percent: 15,
                trusted_organizer_upcoming_events: 4,
                trusted_organizer_percent: 10,
                checked_24h_upcoming_events: 30,
                checked_24h_percent: 75,
                no_source_upcoming_events: 2,
            },
        });
    });
});
