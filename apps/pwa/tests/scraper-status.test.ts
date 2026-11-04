import { describe, expect, it } from 'vitest';
import {
    formatPht,
    groupBySource,
    HISTORY_WINDOWS,
    historyBars,
    historySummary,
    type HistoryWindow,
    legendItems,
    loadScraperHistory,
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
    it('gives each state one of the five words and its pill tone', () => {
        const view = (state: StatusRow['state']) => {
            const v = viewLine(row({ state }));
            return [v.status, v.tone];
        };
        expect(view('working')).toEqual(['Healthy', 'emerald']);
        expect(view('degraded')).toEqual(['Degraded', 'amber']);
        expect(view('broken')).toEqual(['Broken', 'rose']);
        expect(view('unconfirmed')).toEqual(['Unknown', 'amber']);
        expect(view('not_checked')).toEqual(['Unknown', 'amber']);
        expect(view('no_test_event')).toEqual(['Unknown', 'amber']);
        expect(view('not_set_up')).toEqual(['Not configured', 'stone']);
    });

    it('marks every state but healthy and not configured as a problem', () => {
        expect(viewLine(row({ state: 'working' })).problem).toBe(false);
        expect(viewLine(row({ state: 'not_set_up' })).problem).toBe(false);
        expect(viewLine(row({ state: 'degraded' })).problem).toBe(true);
        expect(viewLine(row({ state: 'broken' })).problem).toBe(true);
        expect(viewLine(row({ state: 'not_checked' })).problem).toBe(true);
    });

    it('gives a healthy line one time when its last check was its last success', () => {
        const v = viewLine(
            row({ state: 'working', last_checked_at: '2026-11-04T01:40:04Z', last_worked_at: '2026-11-04T01:40:04Z' }),
        );
        expect(v.times).toEqual(['Last checked: Nov 4, 9:40 AM PHT']);
        expect(v.sentence).toBeNull();
    });

    it("adds a healthy line's last success when it differs from its last check", () => {
        const link = viewLine(
            row({ state: 'working', last_checked_at: '2026-11-04T01:40:04Z', last_worked_at: '2026-11-04T00:40:04Z' }),
        );
        expect(link.times).toEqual(['Last checked: Nov 4, 9:40 AM PHT', 'Last successful: Nov 4, 8:40 AM PHT']);
        const partner = viewLine(
            row({
                line: 'partner_pages',
                state: 'working',
                last_checked_at: '2026-11-04T06:31:00Z',
                last_worked_at: '2026-11-04T00:31:00Z',
            }),
        );
        expect(partner.times).toEqual(['Last checked: Nov 4, 2:31 PM PHT', 'Last fully working: Nov 4, 8:31 AM PHT']);
    });

    it('gives a problem its noticed time, last success and last check, without a first-detected time', () => {
        const v = viewLine(
            row({
                line: 'watched_pages',
                line_label: 'Watched pages',
                state: 'broken',
                since: '2026-11-03T18:30:00Z',
                noticed_at: '2026-11-04T00:30:00Z',
                last_checked_at: '2026-11-04T00:30:04Z',
            }),
        );
        expect(v.times).toEqual([
            'Noticed: Nov 4, 8:30 AM PHT',
            'Last fully working: not in the last 7 days',
            'Last checked: Nov 4, 8:30 AM PHT',
        ]);
    });

    it('says "Last successful" for a link line, whose checks pass or fail whole', () => {
        const v = viewLine(
            row({
                state: 'broken',
                noticed_at: '2026-11-04T01:40:00Z',
                last_checked_at: '2026-11-04T01:40:04Z',
                last_worked_at: '2026-11-03T23:40:04Z',
            }),
        );
        expect(v.times).toEqual([
            'Noticed: Nov 4, 9:40 AM PHT',
            'Last successful: Nov 4, 7:40 AM PHT',
            'Last checked: Nov 4, 9:40 AM PHT',
        ]);
    });

    it('says "not in the last 7 days" for a time it does not have, never "never"', () => {
        const v = viewLine(row({ state: 'not_checked' }));
        expect(v.times).toEqual(['Last successful: not in the last 7 days', 'Last checked: not in the last 7 days']);
    });

    it('gives a line that is not configured no times, sentence or note', () => {
        const v = viewLine(row({ state: 'not_set_up' }));
        expect([v.times, v.sentence, v.note]).toEqual([[], null, null]);
    });

    it('shows a state it does not know as itself instead of failing the page', () => {
        const v = viewLine(row({ state: 'paused' as StatusRow['state'] }));
        expect([v.status, v.tone, v.problem]).toEqual(['paused', 'stone', true]);
    });
});

describe('viewLine sentences: what is affected, never why or how many', () => {
    const partner = { source: 'facebook', line: 'partner_pages', line_label: 'Partner pages' };
    const watched = { source: 'facebook', line: 'watched_pages', line_label: 'Watched pages' };

    it('says how much of a degraded line could not be checked, in words', () => {
        const sentence = (unread: StatusRow['unread']) =>
            viewLine(row({ ...watched, state: 'degraded', latest_result: 'partial', unread })).sentence;
        expect(sentence('some')).toBe("Some watched pages couldn't be checked in the latest run.");
        expect(sentence('most')).toBe("Most watched pages couldn't be checked in the latest run.");
        expect(sentence('all')).toBe('None of the watched pages could be checked in the latest run.');
    });

    it('calls Meetup accounts groups', () => {
        const v = viewLine(row({ source: 'meetup', line: 'finding', state: 'degraded', unread: 'some' }));
        expect(v.sentence).toBe("Some groups couldn't be checked in the latest run.");
    });

    it('says a broken finding line could check none, or not most, in the last 2 runs', () => {
        expect(viewLine(row({ ...watched, state: 'broken', unread: 'all' })).sentence).toBe(
            'None of the watched pages could be checked in the last 2 runs.',
        );
        expect(viewLine(row({ ...watched, state: 'broken', unread: 'most' })).sentence).toBe(
            "Most watched pages couldn't be checked in the last 2 runs.",
        );
    });

    it('says a broken link line could not import its test events', () => {
        expect(viewLine(row({ state: 'broken' })).sentence).toBe("The last 2 checks couldn't import a test event.");
    });

    it('says how long an unknown line has been silent and whether checks are starting', () => {
        const stale = {
            state: 'not_checked' as const,
            last_checked_at: '2026-11-04T01:40:00Z',
            last_run_at: '2026-11-04T04:40:00Z',
            missed_run: true,
        };
        expect(viewLine(row(stale)).sentence).toBe(
            "No result since Nov 4, 9:40 AM PHT. Checks normally run every hour. Checks have started since then but haven't finished.",
        );
        expect(viewLine(row({ ...stale, missed_run: false })).sentence).toBe(
            'No result since Nov 4, 9:40 AM PHT. Checks normally run every hour.',
        );
        expect(viewLine(row({ ...stale, last_run_at: '2026-11-04T01:40:00Z', missed_run: false })).sentence).toBe(
            'No result since Nov 4, 9:40 AM PHT. Checks normally run every hour. No check has started since then.',
        );
        expect(viewLine(row({ ...stale, ...partner, last_run_at: null, missed_run: false })).sentence).toBe(
            'No result since Nov 4, 9:40 AM PHT. Checks normally run every 6 hours. No check has started since then.',
        );
        expect(viewLine(row({ state: 'not_checked' })).sentence).toBe('No results in the last 7 days.');
    });

    it('says a lone failure is waiting for the next check', () => {
        expect(viewLine(row({ state: 'unconfirmed' })).sentence).toBe(
            'The latest check failed. Waiting for the next one to confirm.',
        );
        expect(
            viewLine(row({ ...partner, state: 'unconfirmed', latest_result: 'partial', unread: 'some' })).sentence,
        ).toBe("Some partner pages couldn't be checked in the latest run. Waiting for the next one to confirm.");
    });

    it('says there was no event to test with', () => {
        expect(viewLine(row({ state: 'no_test_event' })).sentence).toBe('No recent event to test with.');
    });

    it('still explains a problem when the database is older than the page', () => {
        expect(viewLine(row({ ...partner, state: 'degraded' })).sentence).toBe(
            "Some partner pages couldn't be checked in the latest run.",
        );
        expect(viewLine(row({ ...watched, state: 'broken' })).sentence).toBe(
            "Most watched pages couldn't be checked in the last 2 runs.",
        );
        expect(viewLine(row({ state: 'not_checked', last_checked_at: '2026-11-04T01:40:00Z' })).sentence).toBe(
            'No result since Nov 4, 9:40 AM PHT. Checks normally run every hour.',
        );
    });

    it('never puts a count in a sentence or a note', () => {
        const states: StatusRow['state'][] = [
            'working',
            'degraded',
            'broken',
            'unconfirmed',
            'not_checked',
            'no_test_event',
        ];
        const levels: StatusRow['unread'][] = ['none', 'some', 'most', 'all', null, undefined];
        const results: StatusRow['latest_result'][] = ['pass', 'partial', 'fail', 'no_sample', null];
        const text: string[] = [];
        for (const state of states)
            for (const unread of levels)
                for (const latest_result of results)
                    for (const line of [{}, partner, watched, { source: 'meetup', line: 'finding' }]) {
                        const v = viewLine(
                            row({
                                ...line,
                                state,
                                unread,
                                latest_result,
                                missed_run: true,
                                last_checked_at: '2026-11-04T01:40:00Z',
                                last_run_at: '2026-11-04T04:40:00Z',
                            }),
                        );
                        text.push(v.sentence ?? '', v.note ?? '');
                    }
        // Times, the schedule ("every 6 hours") and "the last 2 runs/checks" are the only numbers allowed.
        const stripped = text.map((t) =>
            t
                .replace(/[A-Z][a-z]{2} \d+, \d+:\d+ [AP]M PHT/g, '')
                .replace(/every 6 hours/g, '')
                .replace(/last 2 (runs|checks)/g, ''),
        );
        expect(stripped.join('\n')).not.toMatch(/\d/);
    });
});

describe('viewLine notes on healthy lines', () => {
    it('notes a blip without counts', () => {
        const link = viewLine(row({ state: 'working', latest_result: 'fail' }));
        expect(link.note).toBe('The latest check failed; the one before passed.');
        const partner = viewLine(
            row({ line: 'partner_pages', state: 'working', latest_result: 'partial', unread: 'some' }),
        );
        expect(partner.note).toBe("Some partner pages couldn't be checked in the latest run.");
        const most = viewLine(row({ line: 'partner_pages', state: 'working', latest_result: 'fail', unread: 'most' }));
        expect(most.note).toBe("Most partner pages couldn't be checked in the latest run.");
    });

    it('notes a check that did not finish', () => {
        const base = { state: 'working' as const, latest_result: 'pass' as const, missed_run: true };
        expect(viewLine(row(base)).note).toBe("A recent check didn't finish.");
        expect(viewLine(row({ ...base, line: 'finding' })).note).toBe("A recent run didn't finish.");
    });

    it('has no note when the latest check passed and nothing was missed, or the database is older than the page', () => {
        expect(viewLine(row({ state: 'working', missed_run: false, latest_result: 'pass' })).note).toBeNull();
        expect(viewLine(row({ state: 'working' })).note).toBeNull();
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
        expect(overallTone([row({ state: 'degraded' })])).toBe('amber');
        expect(overallTone([row({ state: 'not_checked' }), row({ state: 'broken' })])).toBe('rose');
    });
});

describe('summarize', () => {
    it('counts every line that is neither healthy nor not configured', () => {
        expect(summarize([row({ state: 'working' }), row({ state: 'not_set_up' })])).toBe('All healthy');
        expect(summarize([row({ state: 'broken' }), row({ state: 'working' })])).toBe('1 problem');
        expect(summarize([row({ state: 'broken' }), row({ state: 'not_checked' })])).toBe('2 problems');
        expect(summarize([row({ state: 'degraded' })])).toBe('1 problem');
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

    it('returns null for no lines, so an empty answer never reads as "All healthy"', async () => {
        expect(await loadScraperStatus(fakeRpc({ data: [], error: null }))).toBeNull();
    });

    it('returns null when the answer is not a list', async () => {
        expect(await loadScraperStatus(fakeRpc({ data: { message: 'odd' }, error: null }))).toBeNull();
    });
});

// One 6-hour window as get_scraper_history returns it.
function win(overrides: Partial<HistoryWindow> = {}): HistoryWindow {
    return {
        source: 'meetup',
        line: 'link',
        window_start: '2026-11-03T06:00:00Z',
        result: 'partial',
        ...overrides,
    };
}

// "Now" is Nov 3 13:30 UTC: the window in progress opened at 12:00 UTC.
const NOW = new Date('2026-11-03T13:30:00Z');

describe('historyBars', () => {
    const meetupLink = { source: 'meetup', line: 'link' };

    it('gives 28 six-hour bars, oldest first, ending with the window in progress', () => {
        const bars = historyBars([], meetupLink, NOW);
        expect(bars).toHaveLength(HISTORY_WINDOWS);
        expect(bars[0]).toEqual({
            tone: 'none',
            range: 'Oct 28, 2:00 AM – 8:00 AM PHT',
            result: 'No data',
            label: 'Oct 28, 2:00 AM – 8:00 AM PHT: No data',
        });
        expect(bars[27]).toEqual({
            tone: 'pending',
            range: 'Nov 3, 8:00 PM – 2:00 AM PHT',
            result: 'In progress',
            label: 'Nov 3, 8:00 PM – 2:00 AM PHT: In progress',
        });
    });

    it('gives a bar its time range and result word only', () => {
        const [bar] = historyBars([win()], meetupLink, NOW).slice(26);
        expect(bar).toEqual({
            tone: 'partial',
            range: 'Nov 3, 2:00 PM – 8:00 PM PHT',
            result: 'Partly failed',
            label: 'Nov 3, 2:00 PM – 8:00 PM PHT: Partly failed',
        });
        const missed = historyBars([win({ result: 'missed' })], meetupLink, NOW);
        expect([missed[26].tone, missed[26].result]).toEqual(['missed', "Didn't run"]);
        const noEvent = historyBars([win({ result: 'no_sample' })], meetupLink, NOW);
        expect([noEvent[26].tone, noEvent[26].result]).toEqual(['no_sample', 'No test event']);
    });

    it('shows no counts from the older database, and reads its "mixed" as partly failed', () => {
        // The shape deployed before 20261104020000 also returns checks, passed and failed.
        const old = { ...win({ result: 'mixed' }), checks: 15, passed: 12, failed: 3 } as HistoryWindow;
        const [bar] = historyBars([old], meetupLink, NOW).slice(26);
        expect(bar).toEqual({
            tone: 'partial',
            range: 'Nov 3, 2:00 PM – 8:00 PM PHT',
            result: 'Partly failed',
            label: 'Nov 3, 2:00 PM – 8:00 PM PHT: Partly failed',
        });
    });

    it('ignores other lines and sources', () => {
        const bars = historyBars([win({ source: 'luma' }), win({ line: 'finding' })], meetupLink, NOW);
        expect(bars[26].tone).toBe('none');
    });

    it('never uses a check status word or the page times a reader alerts on', () => {
        const tones: HistoryWindow['result'][] = ['pass', 'partial', 'mixed', 'fail', 'no_sample', 'missed'];
        const windows = tones.map((result, i) =>
            win({
                result,
                window_start: new Date(Date.parse('2026-11-02T00:00:00Z') + i * 6 * 3600 * 1000).toISOString(),
            }),
        );
        const text = [
            ...historyBars(windows, meetupLink, NOW),
            ...historyBars(
                windows.map((w) => ({ ...w, line: 'finding' })),
                { source: 'meetup', line: 'finding' },
                NOW,
            ),
        ]
            .map((b) => b.label)
            .join('\n');
        expect(text).not.toMatch(/Healthy|Degraded|Broken|Unknown|Not configured|Noticed|Updated/);
    });
});

describe('historySummary', () => {
    it('counts the windows by outcome for screen readers', () => {
        const bars = historyBars(
            [
                win(),
                win({ window_start: '2026-11-03T00:00:00Z', result: 'pass' }),
                win({ window_start: '2026-11-02T18:00:00Z', result: 'missed' }),
            ],
            { source: 'meetup', line: 'link' },
            NOW,
        );
        expect(historySummary(bars)).toBe(
            "Last 7 days in 6-hour windows: 1 window passed, 1 partly failed, 1 didn't run, 24 with no data, 1 in progress",
        );
    });
});

describe('legendItems', () => {
    it('lists only the bar colours the page shows, with the empty ones as one "No data"', () => {
        const bars = historyBars(
            [win({ result: 'pass' }), win({ window_start: '2026-11-03T00:00:00Z', result: 'no_sample' })],
            { source: 'meetup', line: 'link' },
            NOW,
        );
        expect(legendItems([bars])).toEqual([
            { tone: 'pass', label: 'Passed' },
            { tone: 'none', label: 'No data' },
        ]);
    });

    it('keeps a fixed order', () => {
        const kinds: HistoryWindow['result'][] = ['missed', 'fail', 'partial', 'pass'];
        const bars = historyBars(
            kinds.map((result, i) =>
                win({
                    result,
                    window_start: new Date(Date.parse('2026-11-02T00:00:00Z') + i * 6 * 3600 * 1000).toISOString(),
                }),
            ),
            { source: 'meetup', line: 'link' },
            NOW,
        );
        expect(legendItems([bars, null]).map((i) => i.label)).toEqual([
            'Passed',
            'Partly failed',
            'Failed',
            "Didn't run",
            'No data',
        ]);
    });
});

describe('groupBySource with history', () => {
    it('gives each check its bars, but none to a check that is not set up', () => {
        const [group] = groupBySource(
            [
                row({ source: 'eventbrite', source_label: 'Eventbrite', line: 'link', state: 'working' }),
                row({ source: 'eventbrite', source_label: 'Eventbrite', line: 'finding', state: 'not_set_up' }),
            ],
            [win({ source: 'eventbrite', result: 'fail' })],
            NOW,
        );
        expect(group.lines[0].bars?.[26].tone).toBe('fail');
        expect(group.lines[0].barsLabel).toContain('1 window failed');
        expect(group.lines[1].bars).toBeNull();
    });

    it('has no bars when the history could not be loaded', () => {
        const [group] = groupBySource([row()], null, NOW);
        expect(group.lines[0].bars).toBeNull();
    });
});

describe('loadScraperHistory', () => {
    it('calls get_scraper_history', async () => {
        const rpc = fakeRpc({ data: [win()], error: null });
        expect(await loadScraperHistory(rpc)).toEqual([win()]);
        expect(rpc.calls).toEqual(['get_scraper_history']);
    });

    it('returns null on an error or an answer that is not a list, so the page still shows without bars', async () => {
        expect(await loadScraperHistory(fakeRpc({ data: null, error: { message: 'x' } }))).toBeNull();
        expect(await loadScraperHistory(fakeRpc({ data: { odd: true }, error: null }))).toBeNull();
    });
});
