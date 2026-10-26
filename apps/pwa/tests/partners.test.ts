import { describe, expect, it } from 'vitest';
import { getPartnerCards } from '../src/lib/partners';

function account(name: string, overrides: Record<string, unknown> = {}) {
    return {
        account_id: name.toLowerCase().replace(/\W+/g, '-'),
        name,
        primary_photo: null,
        type: 'facebook',
        kind: null,
        discovery_path: null,
        created_at: null,
        is_verified: true,
        ingest_kind: 'public_scrape',
        ...overrides,
    };
}

function organizer(account_id: string, event_id: number, start_time: string, status = 'published') {
    return { account_id, event_id, events: { start_time, status } };
}

function fakeSupabase(accounts: unknown[], organizers: unknown[]) {
    return {
        from(table: string) {
            if (table === 'accounts') {
                return { select: () => ({ order: async () => ({ data: accounts, error: null }) }) };
            }
            return { select: async () => ({ data: organizers, error: null }) };
        },
    } as any;
}

describe('getPartnerCards', () => {
    const accounts = [
        account('Alpha Club'),
        account('Dormant Partner', { ingest_kind: 'partnership' }),
        account('Busy Partner', { ingest_kind: 'partnership' }),
        account('Busy Partner', { account_id: 'busy-partner-meetup', type: 'meetup' }),
        account('Hidden Event Partner', { ingest_kind: 'partnership' }),
    ];
    const organizers = [
        organizer('alpha-club', 1, '2026-10-20T10:00:00Z'),
        organizer('dormant-partner', 2, '2024-01-10T10:00:00Z'),
        organizer('busy-partner', 3, '2026-03-01T10:00:00Z'),
        organizer('busy-partner-meetup', 4, '2026-10-18T10:00:00Z'),
        organizer('hidden-event-partner', 5, '2025-01-01T10:00:00Z'),
        organizer('hidden-event-partner', 6, '2026-10-24T10:00:00Z', 'hidden'),
    ];

    it('keeps alphabetical order by default', async () => {
        const { partners } = await getPartnerCards(fakeSupabase(accounts, organizers));

        expect(partners.map((p) => p.name)).toEqual([
            'Alpha Club',
            'Busy Partner',
            'Dormant Partner',
            'Hidden Event Partner',
        ]);
    });

    it('puts partners first, most recently active first, when featured', async () => {
        const { partners } = await getPartnerCards(fakeSupabase(accounts, organizers), { order: 'featured' });

        expect(partners.map((p) => p.name)).toEqual([
            'Busy Partner',
            'Hidden Event Partner',
            'Dormant Partner',
            'Alpha Club',
        ]);
    });

    it('tracks the latest visible event across grouped accounts', async () => {
        const { partners } = await getPartnerCards(fakeSupabase(accounts, organizers), { order: 'featured' });
        const byName = Object.fromEntries(partners.map((p) => [p.name, p.last_event_at]));

        expect(byName['Busy Partner']).toBe('2026-10-18T10:00:00Z');
        expect(byName['Hidden Event Partner']).toBe('2025-01-01T10:00:00Z');
    });

    it('applies the limit after featured ordering', async () => {
        const { partners } = await getPartnerCards(fakeSupabase(accounts, organizers), { order: 'featured', limit: 2 });

        expect(partners.map((p) => p.name)).toEqual(['Busy Partner', 'Hidden Event Partner']);
    });
});
