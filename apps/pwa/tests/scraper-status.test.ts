import { describe, expect, it } from 'vitest';
import {
    formatPht,
    groupBySource,
    loadScraperStatus,
    overallTone,
    plainSpaces,
    type StatusRow,
    summarize,
    updatedLine,
    viewLine,
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

describe('viewLine', () => {
    it('gives each state its fixed word and pill tone', () => {
        const view = (state: StatusRow['state']) => {
            const v = viewLine(row({ state }));
            return [v.status, v.tone];
        };
        expect(view('working')).toEqual(['Working', 'emerald']);
        expect(view('broken')).toEqual(['Broken', 'rose']);
        expect(view('not_checked')).toEqual(['Not checked recently', 'amber']);
        expect(view('no_test_event')).toEqual(['No test event available', 'amber']);
        expect(view('not_set_up')).toEqual(['Not set up', 'stone']);
    });

    it('marks every state but working and not set up as a problem', () => {
        expect(viewLine(row({ state: 'working' })).problem).toBe(false);
        expect(viewLine(row({ state: 'not_set_up' })).problem).toBe(false);
        expect(viewLine(row({ state: 'broken' })).problem).toBe(true);
        expect(viewLine(row({ state: 'not_checked' })).problem).toBe(true);
    });

    it('gives a working line only when it last worked', () => {
        expect(viewLine(row({ state: 'working', last_worked_at: '2026-11-03T14:00:05Z' })).details).toEqual([
            'Last worked: Nov 3, 10:00 PM PHT',
        ]);
    });

    it('says when a broken line started and was noticed, the time a reader alerts on', () => {
        const broken = viewLine(
            row({
                line: 'watched_pages',
                line_label: 'Watched pages',
                state: 'broken',
                since: '2026-11-03T18:30:00Z',
                noticed_at: '2026-11-04T00:30:00Z',
            }),
        );
        expect(broken.label).toBe('Watched pages');
        expect(broken.details).toEqual([
            'Since Nov 4, 2:30 AM PHT',
            'Noticed: Nov 4, 8:30 AM PHT',
            'Last worked: never',
        ]);
    });

    it('leaves out a since time it does not have', () => {
        expect(viewLine(row({ state: 'not_checked', since: null })).details).toEqual(['Last worked: never']);
    });

    it('gives a line that is not set up no times', () => {
        expect(viewLine(row({ state: 'not_set_up' })).details).toEqual([]);
    });

    it('shows a state it does not know as itself instead of failing the page', () => {
        const v = viewLine(row({ state: 'paused' as StatusRow['state'] }));
        expect([v.status, v.tone, v.problem]).toEqual(['paused', 'stone', true]);
    });
});

describe('groupBySource', () => {
    it('keeps page order and puts the lines under their source', () => {
        const groups = groupBySource([
            row({ sort_order: 1, source: 'facebook', source_label: 'Facebook', line_label: 'Importing from a link' }),
            row({ sort_order: 2, source: 'facebook', source_label: 'Facebook', line_label: 'Partner pages' }),
            row({ sort_order: 4, source: 'meetup', source_label: 'Meetup', line_label: 'Importing from a link' }),
        ]);
        expect(groups.map((g) => [g.label, g.lines.map((l) => l.label)])).toEqual([
            ['Facebook', ['Importing from a link', 'Partner pages']],
            ['Meetup', ['Importing from a link']],
        ]);
    });
});

describe('overallTone', () => {
    it('is rose when anything is broken, amber for other problems, emerald otherwise', () => {
        expect(overallTone([row({ state: 'working' }), row({ state: 'not_set_up' })])).toBe('emerald');
        expect(overallTone([row({ state: 'working' }), row({ state: 'not_checked' })])).toBe('amber');
        expect(overallTone([row({ state: 'not_checked' }), row({ state: 'broken' })])).toBe('rose');
    });
});

describe('summarize', () => {
    it('counts every line that is neither working nor not set up', () => {
        expect(summarize([row({ state: 'working' }), row({ state: 'not_set_up' })])).toBe('All working');
        expect(summarize([row({ state: 'broken' }), row({ state: 'working' })])).toBe('1 problem');
        expect(summarize([row({ state: 'broken' }), row({ state: 'not_checked' })])).toBe('2 problems');
    });
});

describe('updatedLine', () => {
    it('gives the page a reference time in PHT, so a reader compares Noticed times without its own clock', () => {
        expect(updatedLine(new Date('2026-11-03T14:05:00Z'))).toBe('Updated: Nov 3, 10:05 PM PHT');
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
