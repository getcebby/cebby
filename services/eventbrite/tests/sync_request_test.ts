import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import type { ServiceHealthEvent } from '@service/core/supabase/shared/service-health.ts';
import { handleSyncRequest } from '../supabase/functions/_shared/sync-request.ts';
import type { OrganizerSyncResult } from '../supabase/functions/_shared/sync-organizer.ts';
import type { AccountRow } from '../supabase/functions/_shared/watched-organizer.ts';

const codeOrange: AccountRow = { account_id: '110850996031', type: 'eventbrite', is_active: true, is_cebu_based: false };

/** Dependencies that record every health row written. */
function deps(opts: { account?: AccountRow | null; lookupThrows?: boolean; sync?: () => Promise<OrganizerSyncResult> }) {
    const rows: ServiceHealthEvent[] = [];
    return {
        rows,
        deps: {
            lookupAccount: (_id: string) =>
                opts.lookupThrows ? Promise.reject(new Error('db down')) : Promise.resolve(opts.account ?? null),
            sync: (_organizer: { account_id: string; is_cebu_based: boolean }) =>
                opts.sync ? opts.sync() : Promise.reject(new Error('sync not expected')),
            record: (row: ServiceHealthEvent) => {
                rows.push(row);
                return Promise.resolve();
            },
        },
    };
}

describe('handleSyncRequest', () => {
    it('refuses a body without an account, and writes nothing', async () => {
        const { rows, deps: d } = deps({});
        expect((await handleSyncRequest({}, d)).status).toBe(400);
        expect((await handleSyncRequest(null, d)).status).toBe(400);
        expect(rows).toEqual([]);
    });

    it('refuses an account that is not a watched organizer, and writes nothing', async () => {
        const { rows, deps: d } = deps({ account: null });
        expect((await handleSyncRequest({ account_id: 'nope' }, d)).status).toBe(404);
        expect(rows).toEqual([]);
    });

    it("records a crash before the organizer is known without counting it on the finding line", async () => {
        const { rows, deps: d } = deps({ lookupThrows: true });
        expect((await handleSyncRequest({ account_id: '110850996031' }, d)).status).toBe(500);
        expect(rows).toHaveLength(1);
        expect(rows[0].fingerprint).toBe('cron_account_failed');
        expect(rows[0].metadata).toEqual({});
    });

    it('counts a crash during a known organizer\'s sync as an unread organizer', async () => {
        const { rows, deps: d } = deps({ account: codeOrange, sync: () => Promise.reject(new Error('boom')) });
        expect((await handleSyncRequest({ account_id: '110850996031' }, d)).status).toBe(500);
        expect(rows[0].fingerprint).toBe('cron_account_failed');
        expect(rows[0].metadata).toMatchObject({ line: 'finding', page_read: false, read_error: 'crashed' });
    });

    it('records the organizer as read, plus one warning per date that failed to import', async () => {
        const { rows, deps: d } = deps({
            account: codeOrange,
            sync: () =>
                Promise.resolve({
                    run: { line: 'finding', pageRead: true, readError: null },
                    ingested: 1,
                    failures: [{ url: 'https://www.eventbrite.com/e/2', message: 'HTTP 503' }],
                }),
        });
        const res = await handleSyncRequest({ account_id: '110850996031' }, d);
        expect(res).toEqual({ status: 200, body: { account_id: '110850996031', ingested: 1, failures: 1 } });
        expect(rows.map((r) => r.fingerprint)).toEqual(['account_processed', 'event_import_failed']);
        expect(rows[0].metadata).toEqual({ ingested: 1, line: 'finding', page_read: true });
        expect(rows[1]).toMatchObject({ status: 'warning', account_id: '110850996031', message: 'HTTP 503' });
        expect(rows[1].metadata).toEqual({ event_url: 'https://www.eventbrite.com/e/2' });
    });
});
