import type { EventFromDB } from '../types/database';
import { getCanonicalSource, getSourceLinks } from './event-attribution';
import type { AttributedSourceLink } from './event-attribution';

export type EventTrustTone = 'emerald' | 'blue' | 'amber' | 'stone';

export interface EventTrustSignal {
    label: string;
    tone: EventTrustTone;
    summary: string;
    detail: string;
}

function isTrustedAccount(account: EventFromDB['accounts']): boolean {
    if (!account) return false;
    if (account.is_verified === true || account.ingest_kind === 'partnership') return true;
    if (account.organizations?.verified_at) return true;

    return account.organizations?.accounts?.some((peer) =>
        peer.is_verified === true || peer.ingest_kind === 'partnership'
    ) ?? false;
}

function getTrustedOrganizerName(event: EventFromDB): string | null {
    if (isTrustedAccount(event.accounts)) {
        return event.accounts?.organizations?.name ?? event.accounts?.name ?? null;
    }

    const trustedOrganizer = (event.organizers ?? []).find((row) => {
        const account = row.accounts;
        return isTrustedAccount(account);
    });

    return trustedOrganizer?.accounts?.organizations?.name ?? trustedOrganizer?.accounts?.name ?? null;
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

    const trustedOrganizerName = getTrustedOrganizerName(event);
    if (trustedOrganizerName) {
        return {
            label: 'Trusted organizer',
            tone: 'emerald',
            summary: `${trustedOrganizerName} is on Cebby's trusted community list.`,
            detail: `${trustedOrganizerName} is on Cebby's trusted community list. The source link stays visible so details can still be checked quickly.`,
        };
    }

    if (canonical.ingest_kind === 'partnership' || canonical.ingest_kind === 'public_api') {
        return {
            label: 'Official source',
            tone: 'emerald',
            summary: `Confirmed from ${canonical.display_name}.`,
            detail: 'The listing is tied to a trusted organizer or a higher-confidence source feed.',
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
