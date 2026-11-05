// One watched organizer's sync: plan its imports, import each date, and say
// whether the organizer was read (the finding line on /status). Takes the planner
// and the importer as dependencies so it can be tested without the network or
// the database.
import type { FindingRun } from '@service/core/supabase/shared/health-checks.ts';
import { countsForCebby } from '@service/core/supabase/shared/cebu-rule.ts';
import type { ImportPlan } from './discovery.ts';
import { placeOfEventbriteEvent } from './event-place.ts';
import type { ImportOne } from './types.ts';

export interface OrganizerSyncResult {
    run: FindingRun;
    /** Dates imported (new or updated) this run. */
    ingested: number;
    /** Dates whose import threw. They don't make the organizer unread. */
    failures: { url: string; message: string }[];
}

type Account = { account_id: string; is_cebu_based: boolean };

export async function syncOrganizer(
    account: Account,
    deps: { plan: (account: Account, deps: { now: Date }) => Promise<ImportPlan>; importOne: ImportOne; now: Date },
): Promise<OrganizerSyncResult> {
    const plan = await deps.plan(account, { now: deps.now });
    if (!plan.pageRead) {
        return { run: { line: 'finding', pageRead: false, readError: plan.readError }, ingested: 0, failures: [] };
    }

    // A series date can sit at its own venue, so each parsed page is checked again.
    const check = (event: Parameters<typeof placeOfEventbriteEvent>[0]) =>
        countsForCebby(placeOfEventbriteEvent(event), account.is_cebu_based);

    let ingested = 0;
    const failures: OrganizerSyncResult['failures'] = [];
    for (const url of plan.urls) {
        try {
            const outcome = await deps.importOne(url, { accountIsCebuBased: account.is_cebu_based, check });
            if (outcome.kind === 'imported') ingested++;
            else if (outcome.kind === 'organizer_failed') {
                failures.push({ url, message: `could not save organizer ${outcome.organizer}` });
            } else console.log(`[eventbrite-cron] ${url}: ${outcome.kind}`);
        } catch (error) {
            failures.push({ url, message: error instanceof Error ? error.message : String(error) });
        }
    }
    return { run: { line: 'finding', pageRead: true, readError: null }, ingested, failures };
}
