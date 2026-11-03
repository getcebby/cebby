// Check-only mode for the *-scraper functions: reads real pages, saves nothing
// but one service_health_events row. Imported only by the scraper entrypoints.
import { supabase } from './client.ts';
import { type LinkProbe, linkCheckResponse } from './health-checks.ts';
import { recordServiceHealthEvent, type ServiceHealthBucket } from './service-health.ts';

/** The database's current test events for a source (`public.link_check_samples`). */
async function loadLinkCheckSamples(bucket: ServiceHealthBucket): Promise<unknown> {
    const { data, error } = await (supabase as any).rpc('link_check_samples', { p_source: bucket });
    if (error) throw new Error(error.message);
    return data;
}

export function handleLinkCheck(
    bucket: ServiceHealthBucket,
    probe: (url: string) => Promise<LinkProbe>,
): Promise<Response> {
    return linkCheckResponse(bucket, () => loadLinkCheckSamples(bucket), probe, recordServiceHealthEvent);
}
