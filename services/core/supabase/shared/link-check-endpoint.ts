// Check-only mode for the *-scraper functions: reads real pages, saves nothing
// but one service_health_events row. Imported only by the scraper entrypoints.
import { type LinkProbe, linkCheckResponse } from './health-checks.ts';
import { recordServiceHealthEvent, type ServiceHealthBucket } from './service-health.ts';

export function handleLinkCheck(
    bucket: ServiceHealthBucket,
    body: unknown,
    probe: (url: string) => Promise<LinkProbe>,
): Promise<Response> {
    return linkCheckResponse(bucket, body, probe, recordServiceHealthEvent);
}
