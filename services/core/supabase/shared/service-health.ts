import { supabase } from './client.ts';

export type ServiceHealthBucket = 'facebook' | 'luma' | 'meetup' | 'typesense' | 'deploy';
export type ServiceHealthStatus = 'success' | 'warning' | 'error';
export type ServiceHealthSeverity = 'info' | 'warning' | 'error' | 'critical';

interface ServiceHealthEvent {
    bucket: ServiceHealthBucket;
    source: string;
    status: ServiceHealthStatus;
    severity?: ServiceHealthSeverity;
    fingerprint: string;
    account_id?: string | null;
    message?: string | null;
    metadata?: Record<string, unknown>;
}

export async function recordServiceHealthEvent(event: ServiceHealthEvent): Promise<void> {
    try {
        const { error } = await (supabase as any)
            .from('service_health_events')
            .insert({
                bucket: event.bucket,
                source: event.source,
                status: event.status,
                severity: event.severity ?? (event.status === 'success' ? 'info' : event.status),
                fingerprint: event.fingerprint,
                account_id: event.account_id ?? null,
                message: event.message ?? null,
                metadata: event.metadata ?? {},
            });

        if (error) {
            console.warn(`[health] failed to record ${event.bucket}/${event.source}: ${error.message}`);
        }
    } catch (error) {
        console.warn(
            `[health] failed to record ${event.bucket}/${event.source}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}
