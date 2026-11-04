import { describe, expect, it } from 'vitest';
import { buildHealthReport, type HealthRow, type Target } from '../src/lib/health-report';

const NOW = new Date('2026-11-04T12:00:00Z');

let nextId = 1;
function healthRow(overrides: Partial<HealthRow>): HealthRow {
    return {
        id: nextId++,
        bucket: 'facebook',
        source: 'retrieve-and-sync-to-db-events',
        status: 'success',
        fingerprint: 'account_processed',
        account_id: null,
        message: null,
        metadata: {},
        occurred_at: '2026-11-04T06:30:05Z',
        ...overrides,
    };
}

const finding = (account: string, read: boolean, extra: Record<string, unknown> = {}, at = '2026-11-04T06:30:05Z') =>
    healthRow({
        account_id: account,
        occurred_at: at,
        message: `processed account ${account} (0 event(s))`,
        metadata: { ingested: 0, line: 'partner_pages', page_read: read, ...extra },
    });

const run = (bucket: string, line: string, at: string, expected?: number) =>
    healthRow({
        bucket,
        source: 'scheduled-run',
        fingerprint: 'run_started',
        occurred_at: at,
        metadata: expected === undefined ? { line } : { line, expected },
    });

const targets: Target[] = [
    { source: 'facebook', line: 'partner_pages', account_id: 'a', name: 'Alpha' },
    { source: 'facebook', line: 'partner_pages', account_id: 'b', name: 'Bravo' },
    { source: 'facebook', line: 'partner_pages', account_id: 'c', name: 'Charlie' },
];

const partner = (report: ReturnType<typeof buildHealthReport>) =>
    report.find((l) => l.source === 'facebook' && l.line === 'partner_pages')!;

describe('buildHealthReport: finding lines', () => {
    it('lists the latest window\'s unread accounts with their cause, and who never reported', () => {
        const report = buildHealthReport({
            targets,
            findingRows: [
                finding('a', true),
                finding('b', false, { read_error: 'token_rejected', read_error_detail: 'Graph API: Session has expired' }),
            ],
            linkRows: [],
            runRows: [run('facebook', 'partner_pages', '2026-11-04T06:30:00Z', 3)],
            now: NOW,
        });
        const line = partner(report);
        expect(line.windowStart).toBe('2026-11-04T06:00:00.000Z');
        expect([line.expected, line.reported, line.read]).toEqual([3, 2, 1]);
        expect(line.unread).toEqual([
            {
                accountId: 'b',
                name: 'Bravo',
                code: 'token_rejected',
                detail: 'Graph API: Session has expired',
                at: '2026-11-04T06:30:05Z',
            },
        ]);
        expect(line.notReported).toEqual([{ accountId: 'c', name: 'Charlie' }]);
    });

    it('shows a row from before causes were recorded as unknown, with its message', () => {
        const line = partner(
            buildHealthReport({ targets, findingRows: [finding('b', false)], linkRows: [], runRows: [], now: NOW }),
        );
        expect(line.unread[0]).toMatchObject({ code: 'unknown', detail: 'processed account b (0 event(s))' });
        expect(line.expected).toBeNull();
    });

    it('uses the newest window at least an hour old, and an account\'s latest row in it', () => {
        const line = partner(
            buildHealthReport({
                targets,
                findingRows: [
                    finding('a', false, {}, '2026-11-04T00:30:05Z'),
                    finding('a', false, {}, '2026-11-04T06:30:05Z'),
                    finding('a', true, {}, '2026-11-04T06:40:00Z'),
                    finding('b', false, {}, '2026-11-04T12:15:05Z'),
                ],
                linkRows: [],
                runRows: [],
                now: new Date('2026-11-04T12:20:00Z'),
            }),
        );
        expect(line.windowStart).toBe('2026-11-04T06:00:00.000Z');
        expect([line.reported, line.read, line.unread]).toEqual([1, 1, []]);
    });

    it('shows a run that started and reported nothing as the latest window, everyone not reported', () => {
        const line = partner(
            buildHealthReport({
                targets,
                findingRows: ['a', 'b', 'c'].map((id) => finding(id, true, {}, '2026-11-04T00:30:05Z')),
                linkRows: [],
                runRows: [
                    run('facebook', 'partner_pages', '2026-11-04T00:30:00Z', 3),
                    run('facebook', 'partner_pages', '2026-11-04T06:30:00Z', 3),
                ],
                now: new Date('2026-11-04T08:00:00Z'),
            }),
        );
        expect(line.windowStart).toBe('2026-11-04T06:00:00.000Z');
        expect([line.expected, line.reported, line.read, line.unread]).toEqual([3, 0, 0, []]);
        expect(line.notReported?.map((a) => a.accountId)).toEqual(['a', 'b', 'c']);
    });

    it('shows a missed run even with no earlier reports', () => {
        const line = partner(
            buildHealthReport({
                targets,
                findingRows: [],
                linkRows: [],
                runRows: [run('facebook', 'partner_pages', '2026-11-04T06:30:00Z', 3)],
                now: new Date('2026-11-04T08:00:00Z'),
            }),
        );
        expect(line.windowStart).toBe('2026-11-04T06:00:00.000Z');
        expect(line.notReported).toHaveLength(3);
    });

    it('does not pick a window whose run is still within its first hour', () => {
        const line = partner(
            buildHealthReport({
                targets,
                findingRows: [finding('a', true, {}, '2026-11-04T00:30:05Z')],
                linkRows: [],
                runRows: [run('facebook', 'partner_pages', '2026-11-04T06:30:00Z', 3)],
                now: new Date('2026-11-04T06:45:00Z'),
            }),
        );
        expect(line.windowStart).toBe('2026-11-04T00:00:00.000Z');
    });

    it('leaves out who never reported when the targets could not be loaded', () => {
        const line = partner(
            buildHealthReport({ targets: null, findingRows: [finding('a', true)], linkRows: [], runRows: [], now: NOW }),
        );
        expect(line.notReported).toBeNull();
    });

    it('names an unread account from the account list when it is not a target', () => {
        const line = partner(
            buildHealthReport({
                targets: null,
                accountNames: { zed: 'Zed Group' },
                findingRows: [finding('zed', false)],
                linkRows: [],
                runRows: [],
                now: NOW,
            }),
        );
        expect(line.unread[0]).toMatchObject({ accountId: 'zed', name: 'Zed Group' });
    });

    it('names an unread account it has no target for by its id', () => {
        const line = partner(
            buildHealthReport({ targets: [], findingRows: [finding('zed', false)], linkRows: [], runRows: [], now: NOW }),
        );
        expect(line.unread[0]).toMatchObject({ accountId: 'zed', name: null });
    });
});

describe('buildHealthReport: link lines', () => {
    const meetupLink = (report: ReturnType<typeof buildHealthReport>) =>
        report.find((l) => l.source === 'meetup' && l.line === 'link')!;

    it('lists failed and no-test-event checks with their attempts, newest first', () => {
        const attempts = [
            { url: 'https://www.meetup.com/g/events/1/', outcome: 'broken', reason: 'missing start time' },
            { url: 'https://www.meetup.com/g/events/2/', outcome: 'broken', reason: 'HTTP 500' },
        ];
        const line = meetupLink(
            buildHealthReport({
                targets,
                findingRows: [],
                linkRows: [
                    healthRow({ bucket: 'meetup', source: 'link-check', status: 'success', occurred_at: '2026-11-04T09:40:03Z', metadata: { line: 'link', attempts: [] } }),
                    healthRow({
                        bucket: 'meetup',
                        source: 'link-check',
                        status: 'error',
                        message: 'missing start time',
                        occurred_at: '2026-11-04T10:40:03Z',
                        metadata: { line: 'link', attempts, failure: 'missing_start_time' },
                    }),
                    healthRow({ bucket: 'meetup', source: 'link-check', status: 'warning', occurred_at: '2026-11-04T11:40:03Z', metadata: { line: 'link', attempts: [] } }),
                ],
                runRows: [],
                now: NOW,
            }),
        );
        expect(line.linkFailures.map((f) => [f.at, f.status, f.failure])).toEqual([
            ['2026-11-04T11:40:03Z', 'warning', null],
            ['2026-11-04T10:40:03Z', 'error', 'missing_start_time'],
        ]);
        expect(line.linkFailures[1].attempts).toEqual(attempts);
    });

    it('counts the link results it saw, so no evidence is never read as all passed', () => {
        const none = meetupLink(buildHealthReport({ targets, findingRows: [], linkRows: [], runRows: [], now: NOW }));
        expect(none.linkResults).toBe(0);
        const some = meetupLink(
            buildHealthReport({
                targets,
                findingRows: [],
                linkRows: [
                    healthRow({ bucket: 'meetup', source: 'link-check', occurred_at: '2026-11-04T10:40:03Z', metadata: { line: 'link' } }),
                    healthRow({ bucket: 'meetup', source: 'link-check', occurred_at: '2026-11-04T11:40:03Z', metadata: { line: 'link' } }),
                    healthRow({ bucket: 'luma', source: 'link-check', occurred_at: '2026-11-04T11:40:03Z', metadata: { line: 'link' } }),
                ],
                runRows: [],
                now: NOW,
            }),
        );
        expect(some.linkResults).toBe(2);
    });

    it('lists started checks that never reported, once they are 10 minutes old', () => {
        const line = meetupLink(
            buildHealthReport({
                targets,
                findingRows: [],
                linkRows: [healthRow({ bucket: 'meetup', source: 'link-check', occurred_at: '2026-11-04T09:40:04Z', metadata: { line: 'link', attempts: [] } })],
                runRows: [
                    run('meetup', 'link', '2026-11-04T09:40:00Z'),
                    run('meetup', 'link', '2026-11-04T10:40:00Z'),
                    run('meetup', 'link', '2026-11-04T11:55:00Z'),
                ],
                now: NOW,
            }),
        );
        expect(line.missedLinkRuns).toEqual(['2026-11-04T10:40:00Z']);
    });
});

describe('buildHealthReport: shape', () => {
    it('covers every line on /status that is set up, in page order', () => {
        const report = buildHealthReport({ targets, findingRows: [], linkRows: [], runRows: [], now: NOW });
        expect(report.map((l) => `${l.source}/${l.line}`)).toEqual([
            'facebook/link',
            'facebook/partner_pages',
            'facebook/watched_pages',
            'meetup/link',
            'meetup/finding',
            'luma/link',
            'luma/finding',
            'eventbrite/link',
        ]);
    });
});
