// The /status page's words. Rows come from public.get_scraper_status()
// (services/core migration 20261103010000_scraper_status.sql); the grok-bot
// routine reads the rendered text, so the wording here is a contract.

export type LineState = 'working' | 'broken' | 'not_checked' | 'no_test_event' | 'not_set_up';

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

const STATES: Record<LineState, { status: string; tone: Tone }> = {
    working: { status: 'Working', tone: 'emerald' },
    broken: { status: 'Broken', tone: 'rose' },
    not_checked: { status: 'Not checked recently', tone: 'amber' },
    no_test_event: { status: 'No test event available', tone: 'amber' },
    not_set_up: { status: 'Not set up', tone: 'stone' },
};

const isProblem = (state: string) => state !== 'working' && state !== 'not_set_up';

/** One check as the page shows it: its name, a status pill, and its times. */
export interface LineView {
    label: string;
    status: string;
    tone: Tone;
    problem: boolean;
    /** "Since …", "Noticed: …" (the time a reader alerts on) and "Last worked: …", as they apply. */
    details: string[];
    /** The last 7 days in 6-hour windows, oldest first; null without history or for a check not set up. */
    bars: Bar[] | null;
    /** The bars in words, for screen readers. */
    barsLabel: string | null;
}

export function viewLine(row: StatusRow): LineView {
    // A state added to the SQL before this page knows it shows as itself, not a crash.
    const { status, tone } = STATES[row.state] ?? { status: row.state, tone: 'stone' };
    const details: string[] = [];
    if (isProblem(row.state) && row.since) details.push(`Since ${formatPht(row.since)}`);
    if (row.noticed_at) details.push(`Noticed: ${formatPht(row.noticed_at)}`);
    if (row.state !== 'not_set_up') {
        details.push(`Last worked: ${row.last_worked_at ? formatPht(row.last_worked_at) : 'never'}`);
    }
    return { label: row.line_label, status, tone, problem: isProblem(row.state), details, bars: null, barsLabel: null };
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
    if (problems === 0) return 'All working';
    return problems === 1 ? '1 problem' : `${problems} problems`;
}

type RpcClient = { rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }> };

/** The lines in page order, or null when they couldn't be loaded. No lines is never "All working". */
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
    /** Link checks run, or accounts tried. */
    checks: number;
    /** Link checks passed, or listing pages read. */
    passed: number;
    failed: number;
    result: 'pass' | 'fail' | 'mixed' | 'no_sample';
}

/** A bar's colour: its window's result, no checks at all, or the window still running. */
export type BarTone = HistoryWindow['result'] | 'none' | 'pending';

export interface Bar {
    tone: BarTone;
    /** Shown on hover: the window in PHT and its counts. */
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

function windowCounts(w: HistoryWindow): string {
    if (w.line !== 'link') return `${w.passed} of ${w.checks} pages read`;
    const noTestEvent = w.checks - w.passed - w.failed;
    return `${w.passed} of ${w.checks} link checks passed${noTestEvent > 0 ? `, ${noTestEvent} had no test event` : ''}`;
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
        const w = mine.get(start);
        if (w) return { tone: w.result, label: `${windowRange(start)}: ${windowCounts(w)}` };
        return start === current
            ? { tone: 'pending', label: `${windowRange(start)}: in progress` }
            : { tone: 'none', label: `${windowRange(start)}: no checks` };
    });
}

const SUMMARY_WORDS: [BarTone, string][] = [
    ['pass', 'passed'],
    ['mixed', 'partly failed'],
    ['fail', 'failed'],
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
