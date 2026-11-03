// Pure logic for scraper health checks. Type-only imports keep this module
// free of client.ts, which throws without Supabase env (tests import it).
import type { ServiceHealthBucket, ServiceHealthEvent } from './service-health.ts';

/** The fields a link check needs back from a real page read. */
export interface CheckedFields {
    name: string | null;
    start_time: string | null;
    location: string | null;
}

/** What a source's probe found at one URL: a parsed page, or a reason to skip it. */
export type LinkProbe = { kind: 'skip'; reason: string } | { kind: 'parsed'; fields: CheckedFields };

export interface LinkCheckSample {
    url: string;
    expect_location: boolean;
}

export interface LinkCheckAttempt {
    url: string;
    outcome: 'ok' | 'skipped' | 'broken';
    reason?: string;
}

export interface LinkCheckResult {
    status: 'passed' | 'failed' | 'no_sample';
    attempts: LinkCheckAttempt[];
}

const MAX_SAMPLES = 3;
const BROKEN_LIMIT = 2;

/** Reads the `samples` value of a check request. Null means it was not an array at all. */
export function parseLinkCheckSamples(value: unknown): LinkCheckSample[] | null {
    if (!Array.isArray(value)) return null;
    const samples: LinkCheckSample[] = [];
    for (const item of value) {
        if (samples.length >= MAX_SAMPLES) break;
        if (
            item &&
            typeof item === 'object' &&
            typeof (item as LinkCheckSample).url === 'string' &&
            typeof (item as LinkCheckSample).expect_location === 'boolean'
        ) {
            samples.push({
                url: (item as LinkCheckSample).url,
                expect_location: (item as LinkCheckSample).expect_location,
            });
        }
    }
    return samples;
}

/** Field presence only: organizers edit titles and reschedule, so values are never compared. */
export function judgeFields(fields: CheckedFields, expectLocation: boolean): string | null {
    if (!fields.name?.trim()) return 'missing title';
    if (!fields.start_time || Number.isNaN(Date.parse(fields.start_time))) return 'missing start time';
    if (expectLocation && !fields.location?.trim()) return 'missing location';
    return null;
}

/**
 * Tries samples in order until one page parses with good fields (passed) or two
 * pages are broken (failed). Skipped pages (gone, series parents) don't count.
 */
export async function runLinkCheck(
    samples: LinkCheckSample[],
    probe: (url: string) => Promise<LinkProbe>,
): Promise<LinkCheckResult> {
    const attempts: LinkCheckAttempt[] = [];
    let broken = 0;

    for (const sample of samples) {
        let reason: string | null;
        try {
            const result = await probe(sample.url);
            if (result.kind === 'skip') {
                attempts.push({ url: sample.url, outcome: 'skipped', reason: result.reason });
                continue;
            }
            reason = judgeFields(result.fields, sample.expect_location);
        } catch (error) {
            reason = error instanceof Error ? error.message : String(error);
        }

        if (reason === null) {
            attempts.push({ url: sample.url, outcome: 'ok' });
            return { status: 'passed', attempts };
        }

        attempts.push({ url: sample.url, outcome: 'broken', reason });
        broken++;
        if (broken >= BROKEN_LIMIT) return { status: 'failed', attempts };
    }

    return { status: broken > 0 ? 'failed' : 'no_sample', attempts };
}

/** The one `service_health_events` row a link check writes. */
export function linkCheckHealthEvent(bucket: ServiceHealthBucket, result: LinkCheckResult): ServiceHealthEvent {
    const metadata = { line: 'link', attempts: result.attempts };
    switch (result.status) {
        case 'passed':
            return {
                bucket,
                source: 'link-check',
                status: 'success',
                fingerprint: 'link_check_passed',
                message: null,
                metadata,
            };
        case 'failed':
            return {
                bucket,
                source: 'link-check',
                status: 'error',
                fingerprint: 'link_check_failed',
                message: result.attempts.find((a) => a.outcome === 'broken')?.reason ?? null,
                metadata,
            };
        case 'no_sample':
            return {
                bucket,
                source: 'link-check',
                status: 'warning',
                fingerprint: 'link_check_no_sample',
                message: 'no usable test event',
                metadata,
            };
    }
}

/** The status line a cron account run reports on. */
export type FindingLine = 'partner_pages' | 'watched_pages' | 'finding';

/** Filled in while a cron processes one account; read when its health row is written. */
export interface FindingRun {
    line: FindingLine | null;
    pageRead: boolean | null;
}

/**
 * Metadata keys the status rules read (`line`, `page_read`). Empty when the run
 * never reached a listing page, so those rows don't count toward the line.
 * A crash before the page was read counts as an unread page.
 */
export function findingMetadata(run: FindingRun, opts: { crashed?: boolean } = {}): Record<string, unknown> {
    if (run.line === null) return {};
    const pageRead = run.pageRead ?? (opts.crashed ? false : null);
    if (pageRead === null) return {};
    return { line: run.line, page_read: pageRead };
}

/**
 * Answers a check-only scraper request: validates `samples`, runs the probe,
 * records one health row through `record`, and returns the result as JSON.
 */
export async function linkCheckResponse(
    bucket: ServiceHealthBucket,
    body: unknown,
    probe: (url: string) => Promise<LinkProbe>,
    record: (event: ServiceHealthEvent) => Promise<void>,
): Promise<Response> {
    const samples = parseLinkCheckSamples((body as { samples?: unknown } | null)?.samples);
    if (samples === null) {
        return Response.json({ error: 'samples must be an array' }, { status: 400 });
    }
    const result = await runLinkCheck(samples, probe);
    await record(linkCheckHealthEvent(bucket, result));
    return Response.json(result);
}
