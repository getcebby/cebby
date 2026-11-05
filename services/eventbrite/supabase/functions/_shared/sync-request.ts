// One request to retrieve-and-sync-to-db-eventbrite-events: which organizer,
// sync it, and the health rows that say how it went. Dependencies are injected
// so the rules about what counts on /status are tested without the network or
// the database.
import type { ServiceHealthEvent } from '@service/core/supabase/shared/service-health.ts';
import { type FindingRun, findingMetadata } from '@service/core/supabase/shared/health-checks.ts';
import type { OrganizerSyncResult } from './sync-organizer.ts';
import { type AccountRow, resolveWatchedOrganizer } from './watched-organizer.ts';

export const SYNC_SOURCE = 'retrieve-and-sync-to-db-eventbrite-events';

type Organizer = { account_id: string; is_cebu_based: boolean };

export interface SyncRequestDeps {
    lookupAccount: (accountId: string) => Promise<AccountRow | null>;
    sync: (organizer: Organizer) => Promise<OrganizerSyncResult>;
    record: (row: ServiceHealthEvent) => Promise<void>;
}

/**
 * Handles one POST body. The body only names the account (any valid JWT reaches
 * the function); the organizer and its Cebu-based flag come from the database.
 * Nothing counts on the finding line until the organizer is known, so a request
 * for no organizer can't move /status.
 */
export async function handleSyncRequest(
    body: unknown,
    deps: SyncRequestDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
    const accountId = body && typeof body === 'object' ? (body as { account_id?: unknown }).account_id : undefined;
    if (typeof accountId !== 'string' || !accountId) return { status: 400, body: { error: 'account_id is required' } };

    let run: FindingRun = { line: null, pageRead: null };
    try {
        const organizer = await resolveWatchedOrganizer(accountId, deps.lookupAccount);
        if (!organizer) return { status: 404, body: { error: `${accountId} is not a watched Eventbrite organizer` } };
        run = { line: 'finding', pageRead: null };

        const result = await deps.sync(organizer);
        run = result.run;
        await deps.record({
            bucket: 'eventbrite',
            source: SYNC_SOURCE,
            status: 'success',
            severity: 'info',
            fingerprint: 'account_processed',
            account_id: organizer.account_id,
            message: `processed organizer ${organizer.account_id} (${result.ingested} event(s))`,
            metadata: { ingested: result.ingested, ...findingMetadata(run) },
        });
        // One row per date that failed to import. No `line` key: these don't count
        // toward the finding line, which is about reading the organizer.
        for (const failure of result.failures) {
            await deps.record({
                bucket: 'eventbrite',
                source: SYNC_SOURCE,
                status: 'warning',
                severity: 'warning',
                fingerprint: 'event_import_failed',
                account_id: organizer.account_id,
                message: failure.message,
                metadata: { event_url: failure.url },
            });
        }
        return {
            status: 200,
            body: { account_id: organizer.account_id, ingested: result.ingested, failures: result.failures.length },
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await deps.record({
            bucket: 'eventbrite',
            source: SYNC_SOURCE,
            status: 'error',
            severity: 'error',
            fingerprint: 'cron_account_failed',
            account_id: accountId,
            message,
            metadata: findingMetadata(run, { crashed: true, error }),
        });
        return { status: 500, body: { error: message } };
    }
}
