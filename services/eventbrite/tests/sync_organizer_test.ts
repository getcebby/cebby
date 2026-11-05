import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { parseEventbriteEventPage } from '../supabase/functions/_shared/eventbriteutils.ts';
import { syncOrganizer } from '../supabase/functions/_shared/sync-organizer.ts';
import type { ImportPlan } from '../supabase/functions/_shared/discovery.ts';
import type { EventbriteEvent, ImportOptions, ImportOutcome } from '../supabase/functions/_shared/types.ts';

const html = Deno.readTextFileSync(new URL('./fixtures/bitcoin-meetup-occurrence.html', import.meta.url));
const page = parseEventbriteEventPage(html, 'https://www.eventbrite.com/e/2002279263176');
if (page?.kind !== 'event') throw new Error('fixture should parse as one event');
const cebuDate: EventbriteEvent = page.event;
const makatiDate: EventbriteEvent = {
    ...cebuDate,
    location: 'Ayala Avenue, Makati',
    venue: { name: 'Somewhere', address: 'Ayala Avenue, Makati', city: 'Makati City', region: 'Metro Manila', country: 'PH', lat: null, lng: null },
};

const account = { account_id: '110850996031', is_cebu_based: false };
const now = new Date('2026-11-05T03:05:56Z');
const imported = (id: number): ImportOutcome => ({
    kind: 'imported',
    result: { event_id: id, is_new_event: true, source_link_id: id, became_canonical: true, match_score: null },
});
const planOf = (plan: ImportPlan) => () => Promise.resolve(plan);

describe('syncOrganizer', () => {
    it("reports an unread organizer and imports nothing", async () => {
        const calls: string[] = [];
        const result = await syncOrganizer(account, {
            plan: planOf({ pageRead: false, readError: { code: 'not_found', detail: 'organizer: HTTP 404' } }),
            importOne: (url) => {
                calls.push(url);
                return Promise.resolve(imported(1));
            },
            now,
        });
        expect(result.run).toEqual({
            line: 'finding',
            pageRead: false,
            readError: { code: 'not_found', detail: 'organizer: HTTP 404' },
        });
        expect(result.ingested).toBe(0);
        expect(calls).toEqual([]);
    });

    it('imports every planned date', async () => {
        const result = await syncOrganizer(account, {
            plan: planOf({ pageRead: true, urls: ['https://www.eventbrite.com/e/1', 'https://www.eventbrite.com/e/2'], skipped: [] }),
            importOne: (_url) => Promise.resolve(imported(1)),
            now,
        });
        expect(result.run.pageRead).toBe(true);
        expect(result.ingested).toBe(2);
        expect(result.failures).toEqual([]);
    });

    it('keeps the organizer read when one import fails, and reports that failure', async () => {
        const result = await syncOrganizer(account, {
            plan: planOf({ pageRead: true, urls: ['https://www.eventbrite.com/e/1', 'https://www.eventbrite.com/e/2'], skipped: [] }),
            importOne: (url) =>
                url.endsWith('/2') ? Promise.reject(new Error('page fetch failed: HTTP 503')) : Promise.resolve(imported(1)),
            now,
        });
        expect(result.run.pageRead).toBe(true);
        expect(result.ingested).toBe(1);
        expect(result.failures).toEqual([{ url: 'https://www.eventbrite.com/e/2', message: 'page fetch failed: HTTP 503' }]);
    });

    it('counts only imported dates, not skipped ones', async () => {
        const result = await syncOrganizer(account, {
            plan: planOf({ pageRead: true, urls: ['https://www.eventbrite.com/e/1'], skipped: [] }),
            importOne: (_url) => Promise.resolve({ kind: 'skipped', reason: 'outside_rule' }),
            now,
        });
        expect(result.ingested).toBe(0);
        expect(result.failures).toEqual([]);
    });

    it("checks each date's own venue against the Cebu rule before it is imported", async () => {
        let options: ImportOptions | undefined;
        await syncOrganizer(account, {
            plan: planOf({ pageRead: true, urls: ['https://www.eventbrite.com/e/1'], skipped: [] }),
            importOne: (_url, opts) => {
                options = opts;
                return Promise.resolve(imported(1));
            },
            now,
        });
        expect(options?.accountIsCebuBased).toBe(false);
        expect(options?.check?.(makatiDate)).toBe(false);
        expect(options?.check?.(cebuDate)).toBe(true);
    });
});
