import { describe, expect, it } from 'vitest';
import {
    describeRow,
    describeState,
    formatPht,
    loadScraperStatus,
    plainSpaces,
    type StatusRow,
    summarize,
} from '../src/lib/scraper-status';

// One line as get_scraper_status returns it; tests override what they need.
function row(overrides: Partial<StatusRow> = {}): StatusRow {
    return {
        sort_order: 1,
        source: 'facebook',
        source_label: 'Facebook',
        line: 'link',
        line_label: 'Importing from a link',
        state: 'working',
        since: null,
        last_worked_at: null,
        last_checked_at: null,
        noticed_at: null,
        ...overrides,
    };
}

function fakeRpc(result: { data: unknown; error: unknown }) {
    const calls: string[] = [];
    return {
        calls,
        rpc(fn: string) {
            calls.push(fn);
            return Promise.resolve(result);
        },
    };
}

describe('formatPht', () => {
    it('shows Manila time with plain spaces', () => {
        // ICU puts U+202F before "PM"; grok-bot and plain-text readers need a normal space.
        expect(formatPht('2026-11-03T07:05:00Z')).toBe('Nov 3, 3:05 PM PHT');
    });

    it('rolls the date over in Manila, not UTC', () => {
        expect(formatPht('2026-11-03T16:30:00Z')).toBe('Nov 4, 12:30 AM PHT');
    });

    it('turns the narrow no-break space some ICU builds put before AM/PM into a plain space', () => {
        // Local Node may not emit U+202F; Cloudflare's runtime can.
        expect(plainSpaces('Nov 3, 3:05\u202fPM')).toBe('Nov 3, 3:05 PM');
        expect(plainSpaces('Nov\u00a03')).toBe('Nov 3');
    });
});

describe('describeState', () => {
    it('uses the fixed page words for each state', () => {
        expect(describeState(row({ state: 'working' }))).toBe('Working');
        expect(describeState(row({ state: 'broken', since: '2026-11-03T07:05:00Z' }))).toBe(
            'Broken since Nov 3, 3:05 PM PHT',
        );
        expect(describeState(row({ state: 'not_checked', since: '2026-11-03T07:05:00Z' }))).toBe(
            'Not checked recently (since Nov 3, 3:05 PM PHT)',
        );
        expect(describeState(row({ state: 'not_checked', since: null }))).toBe('Not checked recently');
        expect(describeState(row({ state: 'no_test_event', since: '2026-11-03T07:05:00Z' }))).toBe(
            'No test event available (since Nov 3, 3:05 PM PHT)',
        );
        expect(describeState(row({ state: 'not_set_up' }))).toBe('Not set up');
    });
});

describe('describeRow', () => {
    it('gives a working line and when it last worked', () => {
        expect(describeRow(row({ state: 'working', last_worked_at: '2026-11-03T14:00:05Z' }))).toBe(
            'Facebook · Importing from a link: Working · Last worked: Nov 3, 10:00 PM PHT',
        );
    });

    it('says when a broken line was noticed, the time a reader alerts on', () => {
        const broken = row({
            line: 'watched_pages',
            line_label: 'Watched pages',
            state: 'broken',
            since: '2026-11-03T18:30:00Z',
            noticed_at: '2026-11-04T00:30:00Z',
        });
        expect(describeRow(broken)).toBe(
            'Facebook · Watched pages: Broken since Nov 4, 2:30 AM PHT · Noticed: Nov 4, 8:30 AM PHT · Last worked: never',
        );
    });

    it('leaves out the last-worked time for a line that is not set up', () => {
        expect(
            describeRow(
                row({ source_label: 'Eventbrite', line_label: 'Finding new events', state: 'not_set_up' }),
            ),
        ).toBe('Eventbrite · Finding new events: Not set up');
    });
});

describe('summarize', () => {
    it('counts every line that is neither working nor not set up', () => {
        expect(summarize([row({ state: 'working' }), row({ state: 'not_set_up' })])).toBe('All working');
        expect(summarize([row({ state: 'broken' }), row({ state: 'working' })])).toBe('1 problem');
        expect(summarize([row({ state: 'broken' }), row({ state: 'not_checked' })])).toBe('2 problems');
    });
});

describe('loadScraperStatus', () => {
    it('calls get_scraper_status and sorts the lines', async () => {
        const rpc = fakeRpc({ data: [row({ sort_order: 2 }), row({ sort_order: 1 })], error: null });
        const rows = await loadScraperStatus(rpc);
        expect(rpc.calls).toEqual(['get_scraper_status']);
        expect(rows!.map((r) => r.sort_order)).toEqual([1, 2]);
    });

    it('returns null on an error', async () => {
        expect(await loadScraperStatus(fakeRpc({ data: null, error: { message: 'x' } }))).toBeNull();
    });

    it('returns null for no lines, so an empty answer never reads as "All working"', async () => {
        expect(await loadScraperStatus(fakeRpc({ data: [], error: null }))).toBeNull();
    });

    it('returns null when the answer is not a list', async () => {
        expect(await loadScraperStatus(fakeRpc({ data: { message: 'odd' }, error: null }))).toBeNull();
    });
});
