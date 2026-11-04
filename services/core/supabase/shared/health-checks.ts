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

/** Why a link check failed, as a fixed code (the reason text itself can carry anything). */
export type LinkFailureCode = 'missing_title' | 'missing_start_time' | 'missing_location' | 'read_error';

const FIELD_FAILURES: Record<string, LinkFailureCode> = {
    'missing title': 'missing_title',
    'missing start time': 'missing_start_time',
    'missing location': 'missing_location',
};

/** judgeFields' reasons name a missing field; anything else (a thrown probe) is a read error. */
export function linkFailureCode(reason: string): LinkFailureCode {
    return FIELD_FAILURES[reason] ?? 'read_error';
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
        case 'failed': {
            const reason = result.attempts.find((a) => a.outcome === 'broken')?.reason ?? null;
            return {
                bucket,
                source: 'link-check',
                status: 'error',
                fingerprint: 'link_check_failed',
                message: reason,
                metadata: { ...metadata, failure: linkFailureCode(reason ?? '') },
            };
        }
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

/**
 * Why a listing page wasn't read. Recorded for the admin health page only:
 * the public /status functions never return these codes or their detail.
 */
export type ReadErrorCode =
    | 'token_rejected'
    | 'permission_denied'
    | 'rate_limited'
    | 'not_found'
    | 'no_event_list'
    | 'unexpected_page'
    | 'fetch_failed'
    | 'crashed'
    | 'other';

export interface ReadFailure {
    code: ReadErrorCode;
    /** The raw message, for the operator. Never shown on /status. */
    detail: string;
}

/** A listing page's HTTP error as a failure: gone, rate limited, or a failed fetch. */
export function httpFailure(status: number, what: string): ReadFailure {
    const code: ReadErrorCode = status === 404 || status === 410
        ? 'not_found'
        : status === 429
        ? 'rate_limited'
        : 'fetch_failed';
    return { code, detail: `${what}: HTTP ${status}` };
}

/** Filled in while a cron processes one account; read when its health row is written. */
export interface FindingRun {
    line: FindingLine | null;
    pageRead: boolean | null;
    /** Why the page wasn't read, when the handler knows. */
    readError?: ReadFailure | null;
}

const DETAIL_LIMIT = 300;

/**
 * Metadata keys the status rules read (`line`, `page_read`). Empty when the run
 * never reached a listing page, so those rows don't count toward the line.
 * A crash before the page was read counts as an unread page. An unread page
 * also carries `read_error` (a ReadErrorCode) and, when there is one,
 * `read_error_detail` (the raw message, cut short) for the admin page.
 */
export function findingMetadata(
    run: FindingRun,
    opts: { crashed?: boolean; error?: unknown } = {},
): Record<string, unknown> {
    if (run.line === null) return {};
    const pageRead = run.pageRead ?? (opts.crashed ? false : null);
    if (pageRead === null) return {};
    if (pageRead) return { line: run.line, page_read: true };

    const crashDetail = opts.error === undefined
        ? ''
        : opts.error instanceof Error
        ? opts.error.message
        : String(opts.error);
    const failure: ReadFailure = run.readError ??
        (opts.crashed ? { code: 'crashed', detail: crashDetail } : { code: 'other', detail: '' });
    const metadata: Record<string, unknown> = { line: run.line, page_read: false, read_error: failure.code };
    if (failure.detail) metadata.read_error_detail = failure.detail.slice(0, DETAIL_LIMIT);
    return metadata;
}

/**
 * Answers a check-only scraper request. The samples come from `loadSamples`
 * (the database's own pick), never from the request, so a caller holding the
 * public anon key can trigger an honest check but can't choose what it reads.
 * Records one health row through `record` and returns the result as JSON.
 */
export async function linkCheckResponse(
    bucket: ServiceHealthBucket,
    loadSamples: () => Promise<unknown>,
    probe: (url: string) => Promise<LinkProbe>,
    record: (event: ServiceHealthEvent) => Promise<void>,
): Promise<Response> {
    let samples: LinkCheckSample[] | null;
    try {
        samples = parseLinkCheckSamples(await loadSamples());
    } catch (error) {
        console.error(`[link-check] ${bucket}: loading samples failed:`, error);
        samples = null;
    }
    if (samples === null) {
        return Response.json({ error: 'could not load samples' }, { status: 500 });
    }
    const result = await runLinkCheck(samples, probe);
    await record(linkCheckHealthEvent(bucket, result));
    return Response.json(result);
}
