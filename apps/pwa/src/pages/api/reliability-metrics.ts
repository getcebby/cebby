import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = false;

export interface ReliabilityMetrics {
    generated_at: string | null;
    latest_checked_at: string | null;
    total_upcoming_events: number;
    sourced_upcoming_events: number;
    sourced_percent: number;
    multi_source_upcoming_events: number;
    multi_source_percent: number;
    trusted_organizer_upcoming_events: number;
    trusted_organizer_percent: number;
    checked_24h_upcoming_events: number;
    checked_24h_percent: number;
    no_source_upcoming_events: number;
}

function normalizeMetrics(row: Partial<ReliabilityMetrics> | null): ReliabilityMetrics | null {
    if (!row) return null;
    return {
        generated_at: row.generated_at ?? null,
        latest_checked_at: row.latest_checked_at ?? null,
        total_upcoming_events: Number(row.total_upcoming_events ?? 0),
        sourced_upcoming_events: Number(row.sourced_upcoming_events ?? 0),
        sourced_percent: Number(row.sourced_percent ?? 0),
        multi_source_upcoming_events: Number(row.multi_source_upcoming_events ?? 0),
        multi_source_percent: Number(row.multi_source_percent ?? 0),
        trusted_organizer_upcoming_events: Number(row.trusted_organizer_upcoming_events ?? 0),
        trusted_organizer_percent: Number(row.trusted_organizer_percent ?? 0),
        checked_24h_upcoming_events: Number(row.checked_24h_upcoming_events ?? 0),
        checked_24h_percent: Number(row.checked_24h_percent ?? 0),
        no_source_upcoming_events: Number(row.no_source_upcoming_events ?? 0),
    };
}

export const GET: APIRoute = async () => {
    const { data, error } = await (supabase as any)
        .from('event_reliability_metrics')
        .select('*')
        .maybeSingle();

    if (error) {
        console.warn('[reliability-metrics] unavailable:', error.message);
        return new Response(JSON.stringify({ available: false, error: 'metrics_unavailable' }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, s-maxage=300, max-age=300, stale-while-revalidate=60',
            },
        });
    }

    return new Response(JSON.stringify({ available: true, metrics: normalizeMetrics(data) }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, s-maxage=300, max-age=300, stale-while-revalidate=60',
        },
    });
};
