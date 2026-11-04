// The /status page's words. Rows come from public.get_scraper_status() and
// public.get_scraper_history() (services/core migration
// 20261104020000_status_diagnostics.sql); the grok-bot routine reads the
// rendered text, so the wording here is a contract. The page says what is
// affected, never why: causes stay in the admin app.

export type LineState =
    | 'working'
    | 'degraded'
    | 'broken'
    | 'unconfirmed'
    | 'not_checked'
    | 'no_test_event'
    | 'not_set_up';

/** The newest result behind a line: counts and times only. */
export interface LatestResult {
    result: 'pass' | 'partial' | 'fail' | 'no_sample';
    at: string;
    /** Finding lines: the window the counts belong to. */
    window_start?: string;
    /** Accounts the run should have reported; null for windows from before this was recorded. */
    expected?: number | null;
    reported?: number;
    read?: number;
}

export interface StatusRow {
    sort_order: number;
    source: string;
    source_label: string;
    line: string;
    line_label: string;
    state: LineState;
    /** When the current problem began. */
    since: string | null;
    last_worked_at: string | null;
    last_checked_at: string | null;
    /** When the current problem became visible (for Broken, the second failure): the time to alert on. */
    noticed_at: string | null;
    // Added by 20261104020000. Optional: the page must still render if it
    // deploys before the database does.
    /** The latest scheduled run's start, or null when none started in 7 days. */
    last_run_at?: string | null;
    /** Scheduled runs since the latest result that never reported. */
    missed_runs?: number | null;
    latest?: LatestResult | null;
}

const PHT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

const PHT_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });

/** Plain spaces for ICU's narrow no-break space (before AM/PM) and no-break space. */
export function plainSpaces(text: string): string {
    return text.replace(/[\u202f\u00a0]/g, ' ');
}

/** "Nov 3, 3:05 PM PHT": Manila time with plain spaces, whatever the runtime's ICU does. */
export function formatPht(iso: string): string {
    return `${plainSpaces(PHT.format(new Date(iso)))} PHT`;
}

/** Pill colours from .impeccable.md's status pill semantics. */
export type Tone = 'emerald' | 'rose' | 'amber' | 'stone';

// Five words for the reader; the SQL states keep the cause, which becomes the sentence.
const STATES: Record<LineState, { status: string; tone: Tone }> = {
    working: { status: 'Healthy', tone: 'emerald' },
    degraded: { status: 'Degraded', tone: 'amber' },
    broken: { status: 'Broken', tone: 'rose' },
    unconfirmed: { status: 'Unknown', tone: 'amber' },
    not_checked: { status: 'Unknown', tone: 'amber' },
    no_test_event: { status: 'Unknown', tone: 'amber' },
    not_set_up: { status: 'Not configured', tone: 'stone' },
};

const isProblem = (state: string) => state !== 'working' && state !== 'not_set_up';

/** One check as the page shows it: its name, a status pill, a sentence, and its times. */
export interface LineView {
    label: string;
    status: string;
    tone: Tone;
    problem: boolean;
    /** A problem row's one sentence: what is affected, never why. */
    sentence: string | null;
    /** A healthy row's quiet note after a blip or a check that didn't finish. */
    note: string | null;
    /** "First detected: …", "Noticed: …" (the time a reader alerts on), "Last checked: …", "Last successful: …". */
    details: string[];
    /** The last 7 days in 6-hour windows, oldest first; null without history or for a check not configured. */
    bars: Bar[] | null;
    /** The bars in words, for screen readers. */
    barsLabel: string | null;
}

const isLink = (line: string) => line === 'link';

/** What a finding line's accounts are called. */
function noun(check: { source: string; line: string }): string {
    if (check.line === 'partner_pages') return 'partner pages';
    if (check.line === 'watched_pages') return 'watched pages';
    return check.source === 'meetup' ? 'groups' : 'pages';
}

/** A finding result's counts: accounts expected (or, before that was recorded, reported) and pages read. */
function findingCounts(latest: LatestResult | null | undefined): { total: number; read: number } | null {
    if (!latest || typeof latest.read !== 'number') return null;
    const total = latest.expected ?? latest.reported;
    return typeof total === 'number' ? { total, read: latest.read } : null;
}

const timeOrGap = (iso: string | null | undefined) => (iso ? formatPht(iso) : 'not in the last 7 days');

function sentenceFor(row: StatusRow): string | null {
    const link = isLink(row.line);
    const counts = link ? null : findingCounts(row.latest);
    const things = noun(row);
    switch (row.state) {
        case 'degraded':
            if (link) return 'Some recent checks failed.';
            return counts
                ? `${counts.total - counts.read} of ${counts.total} ${things} couldn't be checked in the latest run.`
                : `Some ${things} couldn't be checked in the latest run.`;
        case 'broken':
            if (link) return "The last 2 checks couldn't import a test event.";
            if (!counts) return `Most ${things} couldn't be checked in the last 2 runs.`;
            return counts.read === 0
                ? `None of the ${counts.total} ${things} could be checked in the last 2 runs.`
                : `Only ${counts.read} of ${counts.total} ${things} could be checked in the latest run.`;
        case 'not_checked': {
            if (!row.last_checked_at) return 'No results in the last 7 days.';
            const base = `No result since ${formatPht(row.last_checked_at)}. Checks normally run ${
                link ? 'every hour' : 'every 6 hours'
            }.`;
            // Undefined: a database older than this page, which can't tell.
            if (row.last_run_at === undefined) return base;
            const missed = row.missed_runs ?? 0;
            const starting = row.last_run_at !== null && Date.parse(row.last_run_at) > Date.parse(row.last_checked_at);
            if (starting && missed > 0) return `${base} The last ${missed === 1 ? 'one' : missed} didn't finish.`;
            return starting ? base : `${base} No check has started since then.`;
        }
        case 'unconfirmed':
            if (counts && counts.read < counts.total) {
                return `The latest run couldn't check ${counts.total - counts.read} of ${counts.total} ${things}. Waiting for the next one to confirm.`;
            }
            return 'The latest check failed. Waiting for the next one to confirm.';
        case 'no_test_event':
            return 'No recent event to test with.';
        default:
            return null;
    }
}

function noteFor(row: StatusRow): string | null {
    const link = isLink(row.line);
    const latest = row.latest;
    if (latest && latest.result !== 'pass' && latest.result !== 'no_sample') {
        if (link) return 'The latest check failed; the one before passed.';
        const counts = findingCounts(latest);
        if (counts && counts.read < counts.total) {
            return `The latest run couldn't check ${counts.total - counts.read} of ${counts.total} ${noun(row)}.`;
        }
        return `Some ${noun(row)} couldn't be checked in the latest run.`;
    }
    const missed = row.missed_runs ?? 0;
    if (missed > 0) {
        const what = link ? 'check' : 'run';
        return missed === 1
            ? `The latest ${what} didn't finish; the one before passed.`
            : `The last ${missed} ${what}s didn't finish; the one before passed.`;
    }
    return null;
}

export function viewLine(row: StatusRow): LineView {
    // A state added to the SQL before this page knows it shows as itself, not a crash.
    const { status, tone } = STATES[row.state] ?? { status: row.state, tone: 'stone' };
    const problem = isProblem(row.state);
    const view: LineView = {
        label: row.line_label,
        status,
        tone,
        problem,
        sentence: null,
        note: null,
        details: [],
        bars: null,
        barsLabel: null,
    };
    if (row.state === 'not_set_up') return view;
    if (problem) {
        view.sentence = sentenceFor(row);
        if (row.since) view.details.push(`First detected: ${formatPht(row.since)}`);
        if (row.noticed_at) view.details.push(`Noticed: ${formatPht(row.noticed_at)}`);
    } else {
        view.note = noteFor(row);
    }
    view.details.push(`Last checked: ${timeOrGap(row.last_checked_at)}`);
    view.details.push(`Last successful: ${timeOrGap(row.last_worked_at)}`);
    return view;
}

export interface SourceView {
    source: string;
    label: string;
    lines: LineView[];
}

/** The checks under their source, in the order the rows came (page order), with their bars when history loaded. */
export function groupBySource(rows: StatusRow[], history: HistoryWindow[] | null = null, now = new Date()): SourceView[] {
    const groups = new Map<string, SourceView>();
    for (const row of rows) {
        let group = groups.get(row.source);
        if (!group) {
            group = { source: row.source, label: row.source_label, lines: [] };
            groups.set(row.source, group);
        }
        const view = viewLine(row);
        if (history && row.state !== 'not_set_up') {
            view.bars = historyBars(history, row, now);
            view.barsLabel = historySummary(view.bars);
        }
        group.lines.push(view);
    }
    return [...groups.values()];
}

/** The summary's colour: rose if anything is broken, amber for any other problem. */
export function overallTone(rows: StatusRow[]): Tone {
    if (rows.some((r) => r.state === 'broken')) return 'rose';
    return rows.some((r) => isProblem(r.state)) ? 'amber' : 'emerald';
}

/** The page's own reference time: a reader judges "Noticed" times against this, not its own clock. */
export function updatedLine(now: Date): string {
    return `Updated: ${formatPht(now.toISOString())}`;
}

export function summarize(rows: StatusRow[]): string {
    const problems = rows.filter((r) => isProblem(r.state)).length;
    if (problems === 0) return 'All healthy';
    return problems === 1 ? '1 problem' : `${problems} problems`;
}

type RpcClient = { rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }> };

/** The lines in page order, or null when they couldn't be loaded. No lines is never "All healthy". */
export async function loadScraperStatus(client: RpcClient): Promise<StatusRow[] | null> {
    const { data, error } = await client.rpc('get_scraper_status');
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return [...(data as StatusRow[])].sort((a, b) => a.sort_order - b.sort_order);
}

/** One check's 6-hour UTC window, as public.get_scraper_history() returns it (only windows with results). */
export interface HistoryWindow {
    source: string;
    line: string;
    window_start: string;
    /** Link checks with a result, or accounts that reported. */
    checks: number;
    /** Link checks passed, or listing pages read. */
    passed: number;
    failed: number;
    /** 'mixed' is the pre-20261104020000 name for 'partial'. */
    result: 'pass' | 'partial' | 'mixed' | 'fail' | 'no_sample' | 'missed';
    /** Link: checks started; finding: accounts the run should report. Null or absent when not recorded. */
    expected?: number | null;
    /** Started checks that never reported, or expected accounts that didn't. */
    missed?: number | null;
}

/** A bar's colour: its window's result, no checks at all, or the window still running. */
export type BarTone = 'pass' | 'partial' | 'fail' | 'no_sample' | 'missed' | 'none' | 'pending';

export interface Bar {
    tone: BarTone;
    /** The window in PHT. */
    range: string;
    /** The window's result in words. Never one of the check words (Healthy, Broken, …). */
    result: string;
    /** The window's counts in words, or null for a window without checks. */
    counts: string | null;
    /** range, result and counts in one line, for the bar's accessible name. */
    label: string;
}

/** 7 days of 6-hour windows, the span get_scraper_history covers. */
export const HISTORY_WINDOWS = 28;
const WINDOW_MS = 6 * 60 * 60 * 1000;

function windowRange(start: number): string {
    const from = plainSpaces(PHT.format(new Date(start)));
    const to = plainSpaces(PHT_TIME.format(new Date(start + WINDOW_MS)));
    return `${from} – ${to} PHT`;
}

const RESULT_WORDS: Record<BarTone, string> = {
    pass: 'Passed',
    partial: 'Partly failed',
    fail: 'Failed',
    no_sample: 'No test event',
    missed: "Didn't run",
    none: 'No checks',
    pending: 'In progress',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function windowCounts(w: HistoryWindow, check: { source: string; line: string }): string {
    if (!isLink(w.line)) {
        const total = w.expected ?? w.checks;
        const unchecked = total - w.passed;
        const base = `${w.passed} of ${total} ${noun(check)} checked`;
        return unchecked > 0 ? `${base}: ${unchecked} couldn't be checked` : base;
    }
    const missed = w.missed ?? 0;
    const noTestEvent = w.checks - w.passed - w.failed;
    const parts = [
        w.passed > 0 || w.checks > 0 ? `${w.passed} passed` : null,
        w.failed > 0 ? `${w.failed} failed` : null,
        noTestEvent > 0 ? `${noTestEvent} had no test event` : null,
        missed > 0 ? `${missed} didn't run` : null,
    ].filter(Boolean);
    return `${plural(w.checks + missed, 'check', 'checks')}: ${parts.join(', ')}`;
}

function bar(tone: BarTone, range: string, counts: string | null): Bar {
    const result = RESULT_WORDS[tone];
    return { tone, range, result, counts, label: `${range}: ${result}${counts ? `, ${counts}` : ''}` };
}

/** One check's bars, oldest first, ending with the window in progress. */
export function historyBars(windows: HistoryWindow[], check: { source: string; line: string }, now: Date): Bar[] {
    const current = Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS;
    const mine = new Map<number, HistoryWindow>();
    for (const w of windows) {
        if (w.source === check.source && w.line === check.line) mine.set(Date.parse(w.window_start), w);
    }
    return Array.from({ length: HISTORY_WINDOWS }, (_, i): Bar => {
        const start = current - (HISTORY_WINDOWS - 1 - i) * WINDOW_MS;
        const range = windowRange(start);
        const w = mine.get(start);
        if (w) {
            const tone: BarTone = w.result === 'mixed' ? 'partial' : w.result;
            return bar(RESULT_WORDS[tone] ? tone : 'none', range, windowCounts(w, check));
        }
        return bar(start === current ? 'pending' : 'none', range, null);
    });
}

const SUMMARY_WORDS: [BarTone, string][] = [
    ['pass', 'passed'],
    ['partial', 'partly failed'],
    ['fail', 'failed'],
    ['missed', "didn't run"],
    ['no_sample', 'without a test event'],
    ['none', 'without checks'],
    ['pending', 'in progress'],
];

/** The bars in words, e.g. "Last 7 days in 6-hour windows: 20 passed, 1 failed, 7 without checks". */
export function historySummary(bars: Bar[]): string {
    const parts = SUMMARY_WORDS.map(([tone, words]) => ({ n: bars.filter((b) => b.tone === tone).length, words }))
        .filter(({ n }) => n > 0)
        .map(({ n, words }) => `${n} ${words}`);
    return `Last 7 days in 6-hour windows: ${parts.join(', ')}`;
}

/** The windows behind the bars, or null when they couldn't be loaded (the page then shows no bars). */
export async function loadScraperHistory(client: RpcClient): Promise<HistoryWindow[] | null> {
    const { data, error } = await client.rpc('get_scraper_history');
    return error || !Array.isArray(data) ? null : (data as HistoryWindow[]);
}
