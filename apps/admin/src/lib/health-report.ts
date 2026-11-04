// The admin health page: why /status checks fail. Public /status says only
// what is affected; this groups the raw service_health_events rows (causes,
// raw messages, accounts, URLs) per check for the operator. Pure, so it can be
// tested without Supabase. Mirrors the windows and rules of
// services/core/supabase/migrations/20261104020000_status_diagnostics.sql.

/** A row of public.finding_targets(): an account a finding line should report on. */
export interface Target {
    source: string;
    line: string;
    account_id: string;
    name: string | null;
}

/** A public.service_health_events row, as the page selects it. */
export interface HealthRow {
    id: number;
    bucket: string;
    source: string;
    status: string;
    fingerprint: string;
    account_id: string | null;
    message: string | null;
    metadata: Record<string, unknown> | null;
    occurred_at: string;
}

export interface UnreadAccount {
    accountId: string;
    name: string | null;
    /** A ReadErrorCode from the cron, or 'unknown' for rows from before causes were recorded. */
    code: string;
    detail: string | null;
    at: string;
}

export interface LinkAttempt {
    url: string;
    outcome: string;
    reason?: string;
}

export interface LinkFailure {
    at: string;
    /** 'error' (the check failed) or 'warning' (no usable test event). */
    status: string;
    /** A LinkFailureCode, or null for no test event and older rows. */
    failure: string | null;
    message: string | null;
    attempts: LinkAttempt[];
}

export interface LineReport {
    source: string;
    line: string;
    sourceLabel: string;
    lineLabel: string;
    kind: 'link' | 'finding';
    /** Finding lines: the newest 6-hour window at least an hour old (ISO), or null without one. */
    windowStart: string | null;
    expected: number | null;
    reported: number;
    read: number;
    unread: UnreadAccount[];
    /** Targets that didn't report in that window, or null when the targets couldn't be loaded. */
    notReported: { accountId: string; name: string | null }[] | null;
    /** Link lines: how many link-check results the rows held (0 means no evidence, not a pass). */
    linkResults: number;
    /** Link lines: failed and no-test-event checks, newest first. */
    linkFailures: LinkFailure[];
    /** Link lines: start times of checks with no result after 10 minutes, newest first. */
    missedLinkRuns: string[];
}

const LINES: { source: string; line: string; sourceLabel: string; lineLabel: string }[] = [
    { source: 'facebook', line: 'link', sourceLabel: 'Facebook', lineLabel: 'Importing from a link' },
    { source: 'facebook', line: 'partner_pages', sourceLabel: 'Facebook', lineLabel: 'Partner pages' },
    { source: 'facebook', line: 'watched_pages', sourceLabel: 'Facebook', lineLabel: 'Watched pages' },
    { source: 'meetup', line: 'link', sourceLabel: 'Meetup', lineLabel: 'Importing from a link' },
    { source: 'meetup', line: 'finding', sourceLabel: 'Meetup', lineLabel: 'Finding new events' },
    { source: 'luma', line: 'link', sourceLabel: 'Luma', lineLabel: 'Importing from a link' },
    { source: 'luma', line: 'finding', sourceLabel: 'Luma', lineLabel: 'Finding new events' },
    { source: 'eventbrite', line: 'link', sourceLabel: 'Eventbrite', lineLabel: 'Importing from a link' },
];

const WINDOW_MS = 6 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MISSED_AFTER_MS = 10 * 60 * 1000;

const windowOf = (iso: string) => Math.floor(Date.parse(iso) / WINDOW_MS) * WINDOW_MS;
const meta = (row: HealthRow) => row.metadata ?? {};
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

function findingReport(
    base: LineReport,
    rows: HealthRow[],
    runs: HealthRow[],
    targets: Target[] | null,
    accountNames: Record<string, string | null>,
    now: Date,
): LineReport {
    const isJudged = (r: HealthRow) => windowOf(r.occurred_at) + HOUR_MS <= now.getTime();
    const judged = rows.filter(
        (r) => r.bucket === base.source && meta(r).line === base.line && 'page_read' in meta(r) && isJudged(r),
    );
    const myRuns = runs.filter((r) => r.bucket === base.source && meta(r).line === base.line);
    // A run that started and reported nothing is still the latest window: its
    // expected accounts all show as not reported. (One expecting no accounts has
    // nothing to show.)
    const startedRuns = myRuns.filter((r) => isJudged(r) && meta(r).expected !== 0);
    const windows = [...judged, ...startedRuns].map((r) => windowOf(r.occurred_at));
    if (windows.length === 0) return { ...base, notReported: targets ? [] : null };

    const window = Math.max(...windows);
    // Each account's latest row in the window: a rerun counts once.
    const latest = new Map<string, HealthRow>();
    for (const r of judged) {
        if (windowOf(r.occurred_at) !== window) continue;
        const key = r.account_id ?? `row-${r.id}`;
        const seen = latest.get(key);
        if (!seen || Date.parse(r.occurred_at) > Date.parse(seen.occurred_at)) latest.set(key, r);
    }

    const names = new Map<string, string | null>(Object.entries(accountNames));
    for (const t of targets ?? []) names.set(t.account_id, t.name);
    const reportedRows = [...latest.values()];
    const unread = reportedRows
        .filter((r) => meta(r).page_read !== true)
        .map((r): UnreadAccount => ({
            accountId: r.account_id ?? `row ${r.id}`,
            name: (r.account_id && names.get(r.account_id)) ?? null,
            code: text(meta(r).read_error) ?? 'unknown',
            detail: text(meta(r).read_error_detail) ?? r.message,
            at: r.occurred_at,
        }))
        .sort((a, b) => (a.name ?? a.accountId).localeCompare(b.name ?? b.accountId));

    const expectedValues = myRuns
        .filter((r) => windowOf(r.occurred_at) === window)
        .map((r) => meta(r).expected)
        .filter((n): n is number => typeof n === 'number');

    const reportedIds = new Set(reportedRows.map((r) => r.account_id));
    const notReported = targets
        ? targets
              .filter((t) => t.source === base.source && t.line === base.line && !reportedIds.has(t.account_id))
              .map((t) => ({ accountId: t.account_id, name: t.name }))
              .sort((a, b) => (a.name ?? a.accountId).localeCompare(b.name ?? b.accountId))
        : null;

    return {
        ...base,
        windowStart: new Date(window).toISOString(),
        expected: expectedValues.length > 0 ? Math.max(...expectedValues) : null,
        reported: reportedRows.length,
        read: reportedRows.length - unread.length,
        unread,
        notReported,
    };
}

function linkReport(base: LineReport, rows: HealthRow[], runs: HealthRow[], now: Date): LineReport {
    const mine = rows
        .filter((r) => r.bucket === base.source && r.source === 'link-check')
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
    const linkFailures = mine
        .filter((r) => r.status !== 'success')
        .map((r): LinkFailure => ({
            at: r.occurred_at,
            status: r.status,
            failure: text(meta(r).failure),
            message: r.message,
            attempts: Array.isArray(meta(r).attempts) ? (meta(r).attempts as LinkAttempt[]) : [],
        }));
    const resultTimes = mine.map((r) => Date.parse(r.occurred_at));
    const missedLinkRuns = runs
        .filter((r) => r.bucket === base.source && meta(r).line === 'link')
        .map((r) => r.occurred_at)
        .filter((at) => {
            const start = Date.parse(at);
            if (start + MISSED_AFTER_MS > now.getTime()) return false;
            return !resultTimes.some((t) => t >= start && t <= start + MISSED_AFTER_MS);
        })
        .sort((a, b) => Date.parse(b) - Date.parse(a));
    return { ...base, linkResults: mine.length, linkFailures, missedLinkRuns };
}

/** One report per /status check that is set up, in page order. */
export function buildHealthReport(input: {
    targets: Target[] | null;
    /** Names by account id, for accounts that aren't (or can't be loaded as) targets. */
    accountNames?: Record<string, string | null>;
    findingRows: HealthRow[];
    linkRows: HealthRow[];
    runRows: HealthRow[];
    now: Date;
}): LineReport[] {
    return LINES.map((l) => {
        const kind = l.line === 'link' ? 'link' : 'finding';
        const base: LineReport = {
            ...l,
            kind,
            windowStart: null,
            expected: null,
            reported: 0,
            read: 0,
            unread: [],
            notReported: null,
            linkResults: 0,
            linkFailures: [],
            missedLinkRuns: [],
        };
        return kind === 'link'
            ? linkReport(base, input.linkRows, input.runRows, input.now)
            : findingReport(base, input.findingRows, input.runRows, input.targets, input.accountNames ?? {}, input.now);
    });
}
