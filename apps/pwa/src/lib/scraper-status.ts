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
    return { label: row.line_label, status, tone, problem: isProblem(row.state), details };
}

export interface SourceView {
    source: string;
    label: string;
    lines: LineView[];
}

/** The checks under their source, in the order the rows came (page order). */
export function groupBySource(rows: StatusRow[]): SourceView[] {
    const groups = new Map<string, SourceView>();
    for (const row of rows) {
        let group = groups.get(row.source);
        if (!group) {
            group = { source: row.source, label: row.source_label, lines: [] };
            groups.set(row.source, group);
        }
        group.lines.push(viewLine(row));
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

/** The lines in page order, or null when they couldn't be loaded. No lines is never "All working". */
export async function loadScraperStatus(client: {
    rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }>;
}): Promise<StatusRow[] | null> {
    const { data, error } = await client.rpc('get_scraper_status');
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return [...(data as StatusRow[])].sort((a, b) => a.sort_order - b.sort_order);
}
