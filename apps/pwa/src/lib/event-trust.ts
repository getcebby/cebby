import type { EventFromDB } from '../types/database';
import { getCanonicalSource, getSourceLinks } from './event-attribution';
import type { AttributedSourceLink } from './event-attribution';

export type EventTrustTone = 'violet' | 'emerald' | 'amber' | 'stone';

export interface EventTrustSignal {
    label: string;
    tone: EventTrustTone;
    summary: string;
    detail: string;
}

export interface TrustBadge {
    label: string;
    tone: EventTrustTone;
    description: string;
}

/** Every public trust badge, strongest first. getEventTrustSignal can only emit
 * these labels and tones, and the verification explainer renders this list, so
 * the explainer cannot drift from what event cards show. */
export const TRUST_BADGES = [
    {
        label: 'Cebby partner',
        tone: 'violet',
        description: "The organizer has a signed Cebby partnership. These events get Cebby's strongest trust signal.",
    },
    {
        label: 'Trusted organizer',
        tone: 'emerald',
        description: 'Cebby knows and vouches for the organizer, even if the source link came through Luma, Meetup, Facebook, or another platform.',
    },
    {
        label: 'Imported',
        tone: 'stone',
        description: 'Cebby found the event on a public page or platform feed and links back to it.',
    },
    {
        label: 'Community source',
        tone: 'stone',
        description: 'The listing came from a manual or community-submitted source.',
    },
    {
        label: 'Needs review',
        tone: 'amber',
        description: 'The listing is missing a checkable public source or needs more attention.',
    },
] as const satisfies readonly TrustBadge[];

type TrustBadgeLabel = (typeof TRUST_BADGES)[number]['label'];

function trustSignal(label: TrustBadgeLabel, summary: string, detail: string): EventTrustSignal {
    const { tone } = TRUST_BADGES.find((badge) => badge.label === label)!;
    return { label, tone, summary, detail };
}

function isPartnerAccount(account: EventFromDB['accounts']): boolean {
    if (!account) return false;
    if (account.ingest_kind === 'partnership') return true;
    if (account.organizations?.verified_at) return true;

    return account.organizations?.accounts?.some((peer) =>
        peer.ingest_kind === 'partnership'
    ) ?? false;
}

function isTrustedAccount(account: EventFromDB['accounts']): boolean {
    if (!account) return false;
    if (account.is_verified === true) return true;

    return account.organizations?.accounts?.some((peer) =>
        peer.is_verified === true
    ) ?? false;
}

function accountDisplayName(account: EventFromDB['accounts']): string | null {
    return account?.organizations?.name ?? account?.name ?? null;
}

function uniqueNames(names: Array<string | null>): string[] {
    const seen = new Set<string>();
    return names.filter((name): name is string => {
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
    });
}

function formatNameList(names: string[]): string {
    if (names.length <= 1) return names[0] ?? '';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;

    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function getOrganizerNames(event: EventFromDB, predicate: (account: EventFromDB['accounts']) => boolean): string[] {
    if (event.organizers && event.organizers.length > 0) {
        return uniqueNames(
            [...event.organizers]
                .sort((a, b) => a.position - b.position)
                .map((row) =>
                    predicate(row.accounts) ? accountDisplayName(row.accounts) : null
                )
        );
    }

    const names = [
        predicate(event.accounts) ? accountDisplayName(event.accounts) : null,
    ];

    return uniqueNames(names);
}

function getPartnerOrganizerNames(event: EventFromDB): string[] {
    return getOrganizerNames(event, isPartnerAccount);
}

function getTrustedOrganizerName(event: EventFromDB): string | null {
    return getOrganizerNames(event, isTrustedAccount)[0] ?? null;
}

export function getEventTrustSignal(event: EventFromDB): EventTrustSignal {
    const canonical = getCanonicalSource(event);

    if (!canonical) {
        return trustSignal(
            'Needs review',
            'No public source is attached yet.',
            'Treat the listing as tentative until a source link is added.',
        );
    }

    const partnerOrganizerNames = getPartnerOrganizerNames(event);
    if (partnerOrganizerNames.length > 0) {
        const partnerNames = formatNameList(partnerOrganizerNames);
        const hasVerb = partnerOrganizerNames.length === 1 ? 'has' : 'have';
        const partnershipNoun = partnerOrganizerNames.length === 1 ? 'partnership' : 'partnerships';

        return trustSignal(
            'Cebby partner',
            `${partnerNames} ${hasVerb} signed Cebby ${partnershipNoun}.`,
            `${partnerNames} ${hasVerb} signed Cebby ${partnershipNoun}. Partner events get Cebby's strongest trust signal, with the original source still visible for quick verification.`,
        );
    }

    if (canonical.ingest_kind === 'partnership') {
        return trustSignal(
            'Cebby partner',
            'This listing came through a Cebby partnership source.',
            'This source row is tied to a signed Cebby partnership. The original platform link stays visible so details can still be checked quickly.',
        );
    }

    const trustedOrganizerName = getTrustedOrganizerName(event);
    if (trustedOrganizerName) {
        return trustSignal(
            'Trusted organizer',
            `${trustedOrganizerName} is vouched for by Cebby.`,
            `${trustedOrganizerName} is an organizer Cebby knows and vouches for. The source link stays visible so details can still be checked quickly.`,
        );
    }

    if (canonical.ingest_kind === 'manual') {
        return trustSignal(
            'Community source',
            'Added from a community or editorial source.',
            'Cebby keeps the source visible so details can be checked quickly.',
        );
    }

    if (canonical.url) {
        return trustSignal(
            'Imported',
            `Imported from ${canonical.display_name}.`,
            'Cebby links back to the source and refreshes imported listings during regular checks.',
        );
    }

    return trustSignal(
        'Needs review',
        `${canonical.display_name} source is missing a public link.`,
        'The listing needs a source URL before it should be treated as fully checkable.',
    );
}

export function getTrustPillClass(signal: Pick<EventTrustSignal, 'tone'>): string {
    switch (signal.tone) {
        case 'violet':
            return 'proof-chip proof-chip-violet';
        case 'emerald':
            return 'proof-chip proof-chip-emerald';
        case 'amber':
            return 'proof-chip proof-chip-amber';
        case 'stone':
        default:
            return 'proof-chip proof-chip-stone';
    }
}

export function getLastCheckedAt(event: EventFromDB): string | null {
    const timestamps = getSourceLinks(event)
        .map((source) => source.scraped_at)
        .filter((value): value is string => !!value)
        .map((value) => new Date(value))
        .filter((date) => Number.isFinite(date.getTime()))
        .sort((a, b) => b.getTime() - a.getTime());

    return timestamps[0]?.toISOString() ?? null;
}

export function formatLastChecked(iso: string | null, includeYear = false): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return null;

    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(includeYear ? { year: 'numeric' as const } : {}),
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Manila',
    });
}

export function getSourceDomain(source: AttributedSourceLink | null): string | null {
    if (!source?.url) return null;
    try {
        return new URL(source.url).hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}
