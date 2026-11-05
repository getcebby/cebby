// The /status page's words. Rows come from public.get_scraper_status() and
// public.get_scraper_history() (services/core migration
// 20261104020000_status_diagnostics.sql); the grok-bot routine reads the
// rendered text, so the wording here is a contract. The page says what is
// affected, never why or how many: causes and counts stay in the admin app.

export type LineState =
    | 'working'
    | 'degraded'
    | 'broken'
    | 'unconfirmed'
    | 'not_checked'
    | 'no_test_event'
    | 'not_set_up';

/** How much of a finding line wasn't read, in words: the public functions return no counts. */
export type Unread = 'none' | 'some' | 'most' | 'all';

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
    /** The newest result. */
    latest_result?: 'pass' | 'partial' | 'fail' | 'no_sample' | null;
    /** Finding lines: how much wasn't read in the newest result (for Broken, in both of its last two). */
    unread?: Unread | null;
    /** Whether a scheduled run since the newest result never reported. */
    missed_run?: boolean | null;
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
    /**
     * "Label: time" items for one line. A problem: "Noticed: …" (the time a
     * reader alerts on), its last success, "Last checked: …". Healthy: "Last
     * checked: …", and its last success only when that differs.
     */
    times: string[];
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

const timeOrGap = (iso: string | null | undefined) => (iso ? formatPht(iso) : 'not in the last 7 days');

/**
 * A link check passes or fails whole; a finding line can partly work, so its
 * last success is the last time every page in it was checked.
 */
const workedLabel = (line: string) => (isLink(line) ? 'Last successful' : 'Last fully working');

/** "Some partner pages couldn't be checked in the latest run." */
function unreadSentence(unread: Unread | null | undefined, things: string, when: string, fallback: Unread): string {
    const level = unread === 'some' || unread === 'most' || unread === 'all' ? unread : fallback;
    if (level === 'all') return `None of the ${things} could be checked ${when}.`;
    return `${level === 'most' ? 'Most' : 'Some'} ${things} couldn't be checked ${when}.`;
}

function sentenceFor(row: StatusRow): string | null {
    const link = isLink(row.line);
    const things = noun(row);
    switch (row.state) {
        case 'degraded':
            if (link) return 'Some recent checks failed.';
            return unreadSentence(row.unread, things, 'in the latest run', 'some');
        case 'broken':
            if (link) return "The last 2 checks couldn't import a test event.";
            // Broken is two failures (fewer than half read), so "most" holds without the word.
            return unreadSentence(row.unread, things, 'in the last 2 runs', 'most');
        case 'not_checked': {
            if (!row.last_checked_at) return 'No results in the last 7 days.';
            const base = `No result since ${formatPht(row.last_checked_at)}. Checks normally run ${
                link ? 'every hour' : 'every 6 hours'
            }.`;
            // Undefined: a database older than this page, which can't tell.
            if (row.last_run_at === undefined) return base;
            const starting = row.last_run_at !== null && Date.parse(row.last_run_at) > Date.parse(row.last_checked_at);
            if (!starting) return `${base} No check has started since then.`;
            return row.missed_run ? `${base} Checks have started since then but haven't finished.` : base;
        }
        case 'unconfirmed':
            if (link || !row.unread) return 'The latest check failed. Waiting for the next one to confirm.';
            return `${unreadSentence(row.unread, things, 'in the latest run', 'some')} Waiting for the next one to confirm.`;
        case 'no_test_event':
            return 'No recent event to test with.';
        default:
            return null;
    }
}

function noteFor(row: StatusRow): string | null {
    const link = isLink(row.line);
    if (row.latest_result === 'partial' || row.latest_result === 'fail') {
        if (link) return 'The latest check failed; the one before passed.';
        return unreadSentence(row.unread, noun(row), 'in the latest run', 'some');
    }
    if (row.missed_run) return link ? "A recent check didn't finish." : "A recent run didn't finish.";
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
        times: [],
        bars: null,
        barsLabel: null,
    };
    if (row.state === 'not_set_up') return view;
    const checked = `Last checked: ${timeOrGap(row.last_checked_at)}`;
    const worked = `${workedLabel(row.line)}: ${timeOrGap(row.last_worked_at)}`;
    if (problem) {
        // No "first detected": it falls within the hour before "Noticed", and two start times confuse.
        view.sentence = sentenceFor(row);
        if (row.noticed_at) view.times.push(`Noticed: ${formatPht(row.noticed_at)}`);
        view.times.push(worked, checked);
    } else {
        view.note = noteFor(row);
        view.times.push(checked);
        if (timeOrGap(row.last_worked_at) !== timeOrGap(row.last_checked_at)) view.times.push(worked);
    }
    return view;
}

export interface SourceView {
    source: string;
    label: string;
    lines: LineView[];
}

/** The checks under their source, in the order the rows came (page order), with their bars when history loaded. */
export function groupBySource(
    rows: StatusRow[],
    history: HistoryWindow[] | null = null,
    now = new Date(),
): SourceView[] {
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

/**
 * One check's 6-hour UTC window, as public.get_scraper_history() returns it
 * (only windows with results). The shape deployed before 20261104020000 also
 * has checks, passed and failed; the page never reads them.
 */
export interface HistoryWindow {
    source: string;
    line: string;
    window_start: string;
    /** 'mixed' is the pre-20261104020000 name for 'partial'. */
    result: 'pass' | 'partial' | 'mixed' | 'fail' | 'no_sample' | 'missed';
}

/** A bar's colour: its window's result, no checks at all, or the window still running. */
export type BarTone = 'pass' | 'partial' | 'fail' | 'no_sample' | 'missed' | 'none' | 'pending';

/** One bar: its window and result, never counts. */
export interface Bar {
    tone: BarTone;
    /** The window in PHT. */
    range: string;
    /** The window's result in words. Never one of the check words (Healthy, Broken, …). */
    result: string;
    /** range and result in one line, for the bar's accessible name. */
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
    none: 'No data',
    pending: 'In progress',
};

function bar(tone: BarTone, range: string): Bar {
    const result = RESULT_WORDS[tone];
    return { tone, range, result, label: `${range}: ${result}` };
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
            return bar(RESULT_WORDS[tone] ? tone : 'none', range);
        }
        return bar(start === current ? 'pending' : 'none', range);
    });
}

const SUMMARY_WORDS: [BarTone, string][] = [
    ['pass', 'passed'],
    ['partial', 'partly failed'],
    ['fail', 'failed'],
    ['missed', "didn't run"],
    ['no_sample', 'without a test event'],
    ['none', 'with no data'],
    ['pending', 'in progress'],
];

/** The bars in words, e.g. "Last 7 days in 6-hour windows: 20 windows passed, 1 failed, 7 with no data". */
export function historySummary(bars: Bar[]): string {
    const parts = SUMMARY_WORDS.map(([tone, words]) => ({ n: bars.filter((b) => b.tone === tone).length, words }))
        .filter(({ n }) => n > 0)
        .map(({ n, words }, i) => (i === 0 ? `${n} ${n === 1 ? 'window' : 'windows'} ${words}` : `${n} ${words}`));
    return `Last 7 days in 6-hour windows: ${parts.join(', ')}`;
}

/** The legend's entries, in this order; windows without a result share "No data". */
const LEGEND: { tone: BarTone; label: string; tones: BarTone[] }[] = [
    { tone: 'pass', label: 'Passed', tones: ['pass'] },
    { tone: 'partial', label: 'Partly failed', tones: ['partial'] },
    { tone: 'fail', label: 'Failed', tones: ['fail'] },
    { tone: 'missed', label: "Didn't run", tones: ['missed'] },
    { tone: 'none', label: 'No data', tones: ['none', 'no_sample', 'pending'] },
];

/** Only the legend entries whose colours the page shows. */
export function legendItems(bars: (Bar[] | null)[]): { tone: BarTone; label: string }[] {
    const shown = new Set(bars.flatMap((b) => (b ?? []).map((x) => x.tone)));
    return LEGEND.filter((item) => item.tones.some((t) => shown.has(t))).map(({ tone, label }) => ({ tone, label }));
}

/** The windows behind the bars, or null when they couldn't be loaded (the page then shows no bars). */
export async function loadScraperHistory(client: RpcClient): Promise<HistoryWindow[] | null> {
    const { data, error } = await client.rpc('get_scraper_history');
    return error || !Array.isArray(data) ? null : (data as HistoryWindow[]);
}
