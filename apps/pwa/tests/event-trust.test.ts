import { describe, expect, it } from 'vitest';
import { getEventTrustSignal, getTrustPillClass, TRUST_BADGES } from '../src/lib/event-trust';
import type { EventFromDB } from '../src/types/database';

function event({
    ingestKind = 'public_scrape',
    url = 'https://lu.ma/example',
    organizer,
}: {
    ingestKind?: string;
    url?: string | null;
    organizer?: { name: string; is_verified?: boolean; ingest_kind?: string };
} = {}): EventFromDB {
    return {
        primary_source_link_id: 1,
        source_links: [{ id: 1, source: 'luma', url, ingest_kind: ingestKind, scraped_at: null }],
        organizers: organizer
            ? [{ role: 'host', position: 0, accounts: { account_id: 'org-1', is_verified: false, ...organizer } }]
            : [],
    } as unknown as EventFromDB;
}

const fixtures = {
    partnerOrganizer: event({ organizer: { name: 'DEVCON Cebu', ingest_kind: 'partnership' } }),
    partnershipSource: event({ ingestKind: 'partnership' }),
    trustedOrganizer: event({ organizer: { name: 'Golang Cebu', is_verified: true } }),
    publicApi: event({ ingestKind: 'public_api' }),
    community: event({ ingestKind: 'manual' }),
    imported: event(),
    missingUrl: event({ url: null }),
    noSource: { source_links: [], organizers: [] } as unknown as EventFromDB,
};

describe('getEventTrustSignal', () => {
    it('labels each case on the confidence ladder', () => {
        const labels = Object.fromEntries(
            Object.entries(fixtures).map(([name, fixture]) => [name, getEventTrustSignal(fixture).label]),
        );

        expect(labels).toEqual({
            partnerOrganizer: 'Cebby partner',
            partnershipSource: 'Cebby partner',
            trustedOrganizer: 'Trusted organizer',
            publicApi: 'Imported',
            community: 'Community source',
            imported: 'Imported',
            missingUrl: 'Needs review',
            noSource: 'Needs review',
        });
    });

    it('only emits badges documented in TRUST_BADGES, with the documented tone', () => {
        for (const fixture of Object.values(fixtures)) {
            const signal = getEventTrustSignal(fixture);
            const badge = TRUST_BADGES.find((b) => b.label === signal.label);

            expect(badge, signal.label).toBeDefined();
            expect(signal.tone).toBe(badge!.tone);
        }
    });
});

describe('TRUST_BADGES', () => {
    it('lists the ladder from strongest to weakest', () => {
        expect(TRUST_BADGES.map((b) => [b.label, b.tone])).toEqual([
            ['Cebby partner', 'violet'],
            ['Trusted organizer', 'emerald'],
            ['Imported', 'stone'],
            ['Community source', 'stone'],
            ['Needs review', 'amber'],
        ]);
    });

    it('maps every tone to its proof chip class', () => {
        expect(TRUST_BADGES.map((b) => getTrustPillClass(b))).toEqual([
            'proof-chip proof-chip-violet',
            'proof-chip proof-chip-emerald',
            'proof-chip proof-chip-stone',
            'proof-chip proof-chip-stone',
            'proof-chip proof-chip-amber',
        ]);
    });
});
