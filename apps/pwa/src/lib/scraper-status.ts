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

const sinceSuffix = (since: string | null) => (since ? ` (since ${formatPht(since)})` : '');

export function describeState(row: StatusRow): string {
    switch (row.state) {
        case 'working':
            return 'Working';
        case 'broken':
            return row.since ? `Broken since ${formatPht(row.since)}` : 'Broken';
        case 'not_checked':
            return `Not checked recently${sinceSuffix(row.since)}`;
        case 'no_test_event':
            return `No test event available${sinceSuffix(row.since)}`;
        case 'not_set_up':
            return 'Not set up';
    }
}

/** One line of the page: "Facebook · Watched pages: Broken since … · Noticed: … · Last worked: …". */
export function describeRow(row: StatusRow): string {
    let text = `${row.source_label} · ${row.line_label}: ${describeState(row)}`;
    if (row.noticed_at) text += ` · Noticed: ${formatPht(row.noticed_at)}`;
    if (row.state !== 'not_set_up') {
        text += ` · Last worked: ${row.last_worked_at ? formatPht(row.last_worked_at) : 'never'}`;
    }
    return text;
}

/** The page's own reference time: a reader judges "Noticed" times against this, not its own clock. */
export function updatedLine(now: Date): string {
    return `Updated: ${formatPht(now.toISOString())}`;
}

export function summarize(rows: StatusRow[]): string {
    const problems = rows.filter((r) => r.state !== 'working' && r.state !== 'not_set_up').length;
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
