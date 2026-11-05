import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { type AccountRow, resolveWatchedOrganizer } from '../supabase/functions/_shared/watched-organizer.ts';

const rows: Record<string, AccountRow> = {
    '110850996031': { account_id: '110850996031', type: 'eventbrite', is_active: true, is_cebu_based: false },
    '109571894561': { account_id: '109571894561', type: 'eventbrite', is_active: true, is_cebu_based: true },
    'off': { account_id: 'off', type: 'eventbrite', is_active: false, is_cebu_based: true },
    'fb-page': { account_id: 'fb-page', type: 'facebook', is_active: true, is_cebu_based: true },
};
const lookup = (id: string) => Promise.resolve(rows[id] ?? null);

describe('resolveWatchedOrganizer', () => {
    it("takes the organizer's Cebu-based flag from the database", async () => {
        expect(await resolveWatchedOrganizer('109571894561', lookup)).toEqual({
            account_id: '109571894561',
            is_cebu_based: true,
        });
        expect(await resolveWatchedOrganizer('110850996031', lookup)).toEqual({
            account_id: '110850996031',
            is_cebu_based: false,
        });
    });

    it('refuses an account that is unknown, turned off, or not an Eventbrite organizer', async () => {
        expect(await resolveWatchedOrganizer('999', lookup)).toBe(null);
        expect(await resolveWatchedOrganizer('off', lookup)).toBe(null);
        expect(await resolveWatchedOrganizer('fb-page', lookup)).toBe(null);
    });
});
