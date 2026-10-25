import type { EventFromDB } from '../types/database';
import { getCanonicalSource, getSourceLinks } from './event-attribution';
import type { AttributedSourceLink } from './event-attribution';

export type EventTrustTone = 'violet' | 'emerald' | 'blue' | 'amber' | 'stone';

export interface EventTrustSignal {
    label: string;
    tone: EventTrustTone;
    summary: string;
    detail: string;
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
        return {
            label: 'Needs review',
            tone: 'amber',
            summary: 'No public source is attached yet.',
            detail: 'Treat the listing as tentative until a source link is added.',
        };
    }

    const partnerOrganizerNames = getPartnerOrganizerNames(event);
    if (partnerOrganizerNames.length > 0) {
        const partnerNames = formatNameList(partnerOrganizerNames);
        const hasVerb = partnerOrganizerNames.length === 1 ? 'has' : 'have';
        const partnershipNoun = partnerOrganizerNames.length === 1 ? 'partnership' : 'partnerships';

        return {
            label: 'Cebby partner',
            tone: 'violet',
            summary: `${partnerNames} ${hasVerb} signed Cebby ${partnershipNoun}.`,
            detail: `${partnerNames} ${hasVerb} signed Cebby ${partnershipNoun}. Partner events get Cebby's strongest trust signal, with the original source still visible for quick verification.`,
        };
    }

    if (canonical.ingest_kind === 'partnership') {
        return {
            label: 'Cebby partner',
            tone: 'violet',
            summary: 'This listing came through a Cebby partnership source.',
            detail: 'This source row is tied to a signed Cebby partnership. The original platform link stays visible so details can still be checked quickly.',
        };
    }

    const trustedOrganizerName = getTrustedOrganizerName(event);
    if (trustedOrganizerName) {
        return {
            label: 'Trusted organizer',
            tone: 'emerald',
            summary: `${trustedOrganizerName} is vouched for by Cebby.`,
            detail: `${trustedOrganizerName} is an organizer Cebby knows and vouches for. The source link stays visible so details can still be checked quickly.`,
        };
    }

    if (canonical.ingest_kind === 'public_api') {
        return {
            label: 'Official source',
            tone: 'blue',
            summary: `Confirmed from ${canonical.display_name}.`,
            detail: 'This listing comes from a source the organizer controls, like an official event page or platform profile. The source link stays visible for quick checking.',
        };
    }

    if (canonical.ingest_kind === 'manual') {
        return {
            label: 'Community source',
            tone: 'blue',
            summary: 'Added from a community or editorial source.',
            detail: 'Cebby keeps the source visible so details can be checked quickly.',
        };
    }

    if (canonical.url) {
        return {
            label: 'Imported',
            tone: 'stone',
            summary: `Imported from ${canonical.display_name}.`,
            detail: 'Cebby links back to the source and refreshes imported listings during regular checks.',
        };
    }

    return {
        label: 'Needs review',
        tone: 'amber',
        summary: `${canonical.display_name} source is missing a public link.`,
        detail: 'The listing needs a source URL before it should be treated as fully checkable.',
    };
}

export function getTrustPillClass(signal: EventTrustSignal): string {
    switch (signal.tone) {
        case 'violet':
            return 'proof-chip proof-chip-violet';
        case 'emerald':
            return 'proof-chip proof-chip-emerald';
        case 'blue':
            return 'proof-chip proof-chip-blue';
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
