import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import {
    findingMetadata,
    judgeFields,
    linkCheckHealthEvent,
    type LinkProbe,
    linkCheckResponse,
    parseLinkCheckSamples,
    runLinkCheck,
} from '../supabase/shared/health-checks.ts';

const OK: LinkProbe = {
    kind: 'parsed',
    fields: { name: 'X', start_time: '2026-11-21T01:00:00Z', location: 'A' },
};

/** A probe whose outcome per URL is fixed; records every URL it was asked to read. */
function probeFrom(outcomes: Record<string, LinkProbe | Error>) {
    const calls: string[] = [];
    const probe = (url: string): Promise<LinkProbe> => {
        calls.push(url);
        const outcome = outcomes[url];
        if (outcome instanceof Error) return Promise.reject(outcome);
        return Promise.resolve(outcome);
    };
    return { probe, calls };
}

const sample = (url: string) => ({ url, expect_location: false });

describe('parseLinkCheckSamples', () => {
    it('returns null when the value is not an array', () => {
        expect(parseLinkCheckSamples('nope')).toBeNull();
        expect(parseLinkCheckSamples(undefined)).toBeNull();
    });

    it('keeps only well-formed items, at most 3', () => {
        expect(
            parseLinkCheckSamples([
                { url: 'a', expect_location: true },
                { url: 1 },
                { url: 'b', expect_location: false },
                { url: 'c', expect_location: false },
                { url: 'd', expect_location: false },
            ]),
        ).toEqual([
            { url: 'a', expect_location: true },
            { url: 'b', expect_location: false },
            { url: 'c', expect_location: false },
        ]);
    });
});

describe('judgeFields', () => {
    it('accepts a title and a valid start time when no location is expected', () => {
        expect(judgeFields({ name: 'X', start_time: '2026-11-21T01:00:00Z', location: null }, false)).toBeNull();
    });

    it('rejects a blank title', () => {
        expect(judgeFields({ name: '  ', start_time: '2026-11-21T01:00:00Z', location: 'A' }, false)).toBe(
            'missing title',
        );
    });

    it('rejects an unparseable start time', () => {
        expect(judgeFields({ name: 'X', start_time: 'not a date', location: 'A' }, false)).toBe('missing start time');
    });

    it('rejects a missing location when one is expected', () => {
        expect(judgeFields({ name: 'X', start_time: '2026-11-21T01:00:00Z', location: null }, true)).toBe(
            'missing location',
        );
    });
});

describe('runLinkCheck', () => {
    it('passes on the first good page and stops probing', async () => {
        const { probe, calls } = probeFrom({ a: OK, b: OK });
        expect(await runLinkCheck([sample('a'), sample('b')], probe)).toEqual({
            status: 'passed',
            attempts: [{ url: 'a', outcome: 'ok' }],
        });
        expect(calls).toEqual(['a']);
    });

    it('treats a skipped event as not a failure', async () => {
        const { probe } = probeFrom({ a: { kind: 'skip', reason: 'gone (HTTP 404)' }, b: OK });
        expect(await runLinkCheck([sample('a'), sample('b')], probe)).toEqual({
            status: 'passed',
            attempts: [
                { url: 'a', outcome: 'skipped', reason: 'gone (HTTP 404)' },
                { url: 'b', outcome: 'ok' },
            ],
        });
    });

    it('fails after two broken events, counting a thrown probe as broken', async () => {
        const { probe, calls } = probeFrom({
            a: new Error('HTTP 500'),
            b: { kind: 'parsed', fields: { name: '', start_time: '2026-11-21T01:00:00Z', location: null } },
            c: OK,
        });
        const result = await runLinkCheck([sample('a'), sample('b'), sample('c')], probe);
        expect(result).toEqual({
            status: 'failed',
            attempts: [
                { url: 'a', outcome: 'broken', reason: 'HTTP 500' },
                { url: 'b', outcome: 'broken', reason: 'missing title' },
            ],
        });
        expect(calls).toEqual(['a', 'b']);
    });

    it('fails when one event is broken and the samples run out', async () => {
        const { probe } = probeFrom({ a: { kind: 'skip', reason: 'series page' }, b: new Error('boom') });
        const result = await runLinkCheck([sample('a'), sample('b')], probe);
        expect(result.status).toBe('failed');
    });

    it('reports no_sample when there is nothing usable', async () => {
        const { probe } = probeFrom({
            a: { kind: 'skip', reason: 'gone (HTTP 404)' },
            b: { kind: 'skip', reason: 'gone (HTTP 410)' },
        });
        expect(await runLinkCheck([], probe)).toEqual({ status: 'no_sample', attempts: [] });
        expect((await runLinkCheck([sample('a'), sample('b')], probe)).status).toBe('no_sample');
    });
});

describe('linkCheckHealthEvent', () => {
    it('records a failure with the first broken reason', () => {
        expect(
            linkCheckHealthEvent('meetup', {
                status: 'failed',
                attempts: [{ url: 'u', outcome: 'broken', reason: 'HTTP 500' }],
            }),
        ).toEqual({
            bucket: 'meetup',
            source: 'link-check',
            status: 'error',
            fingerprint: 'link_check_failed',
            message: 'HTTP 500',
            metadata: { line: 'link', attempts: [{ url: 'u', outcome: 'broken', reason: 'HTTP 500' }] },
        });
    });

    it('records a pass as success with no message', () => {
        const attempts = [{ url: 'u', outcome: 'ok' as const }];
        expect(linkCheckHealthEvent('luma', { status: 'passed', attempts })).toEqual({
            bucket: 'luma',
            source: 'link-check',
            status: 'success',
            fingerprint: 'link_check_passed',
            message: null,
            metadata: { line: 'link', attempts },
        });
    });

    it('records no_sample as a warning', () => {
        expect(linkCheckHealthEvent('eventbrite', { status: 'no_sample', attempts: [] })).toEqual({
            bucket: 'eventbrite',
            source: 'link-check',
            status: 'warning',
            fingerprint: 'link_check_no_sample',
            message: 'no usable test event',
            metadata: { line: 'link', attempts: [] },
        });
    });
});

describe('linkCheckResponse', () => {
    it('rejects a body whose samples is not an array, recording nothing', async () => {
        const recorded: unknown[] = [];
        const { probe } = probeFrom({});
        const res = await linkCheckResponse('meetup', { mode: 'check' }, probe, async (e) => {
            recorded.push(e);
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'samples must be an array' });
        expect(recorded).toEqual([]);
    });

    it('runs the check, records one row and returns the result', async () => {
        const recorded: unknown[] = [];
        const { probe } = probeFrom({ a: OK });
        const res = await linkCheckResponse(
            'luma',
            { mode: 'check', samples: [{ url: 'a', expect_location: true }] },
            probe,
            async (e) => {
                recorded.push(e);
            },
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'passed', attempts: [{ url: 'a', outcome: 'ok' }] });
        expect(recorded).toEqual([
            linkCheckHealthEvent('luma', { status: 'passed', attempts: [{ url: 'a', outcome: 'ok' }] }),
        ]);
    });
});

describe('findingMetadata', () => {
    it('adds nothing when the run has no line or never read a page', () => {
        expect(findingMetadata({ line: null, pageRead: null })).toEqual({});
        expect(findingMetadata({ line: 'finding', pageRead: null })).toEqual({});
    });

    it('records the line and whether the page was read', () => {
        expect(findingMetadata({ line: 'finding', pageRead: true })).toEqual({ line: 'finding', page_read: true });
    });

    it('marks an unread page as not read when the run crashed', () => {
        expect(findingMetadata({ line: 'watched_pages', pageRead: null }, { crashed: true })).toEqual({
            line: 'watched_pages',
            page_read: false,
        });
    });

    it('keeps a page that was read as read even if the run crashed later', () => {
        expect(findingMetadata({ line: 'partner_pages', pageRead: true }, { crashed: true })).toEqual({
            line: 'partner_pages',
            page_read: true,
        });
    });

    it('adds nothing for a crashed run with no line', () => {
        expect(findingMetadata({ line: null, pageRead: null }, { crashed: true })).toEqual({});
    });
});
