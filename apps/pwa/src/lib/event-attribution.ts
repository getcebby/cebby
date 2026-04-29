/**
 * Helpers for resolving event attribution from the multi-source model
 * (event_organizers, event_source_links) — with graceful fallback to legacy
 * single-organizer fields (event.accounts, event.source) so events ingested
 * before the multi-org migration still render correctly.
 *
 * Use these instead of reading event.accounts / event.source directly in
 * components, so the day we drop the legacy columns nothing breaks at the
 * UI layer.
 */
import type {
    AccountsFromDB,
    EventFromDB,
    EventOrganizerRow,
    EventSourceLinkRow,
} from '../types/database';

export interface AttributedOrganizer {
    account_id: string;
    name: string;
    primary_photo: string | null;
    role: string;
    position: number;
}

export interface AttributedSourceLink {
    /** Raw source slug — 'facebook' | 'luma' | 'meetup' | 'eventbrite' | … */
    source: string;
    /** Title-cased label suitable for display ("Luma", "Facebook", …). */
    display_name: string;
    /** External URL to this event on the source platform, when known. */
    url: string | null;
    /** True when this is the event's `primary_source_link_id` (canonical content). */
    is_canonical: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
    facebook: 'Facebook',
    luma: 'Luma',
    meetup: 'Meetup',
    eventbrite: 'Eventbrite',
    website: 'Website',
    manual: 'Manual',
};

function labelForSource(source: string): string {
    const lower = source.toLowerCase();
    if (SOURCE_LABELS[lower]) return SOURCE_LABELS[lower];
    // Fallback: title-case unknown sources so we never render raw slugs.
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function organizerRowToAttributed(row: EventOrganizerRow): AttributedOrganizer | null {
    if (!row.accounts || !row.accounts.name) return null;
    return {
        account_id: String(row.accounts.account_id ?? row.accounts.id ?? ''),
        name: row.accounts.name,
        primary_photo: row.accounts.primary_photo ?? null,
        role: row.role,
        position: row.position,
    };
}

function legacyAccountToAttributed(account: AccountsFromDB): AttributedOrganizer {
    return {
        account_id: String(account.account_id ?? account.id ?? ''),
        name: account.name,
        primary_photo: account.primary_photo ?? null,
        role: 'presenter',
        position: 0,
    };
}

/**
 * The "Presented by" organizer for the event — typically a community calendar
 * (Geeks on a Beach), FB page (PizzaPy), or Meetup group. Returns null when
 * the event has no organizer attribution at all.
 */
export function getPrimaryOrganizer(event: EventFromDB): AttributedOrganizer | null {
    if (event.organizers && event.organizers.length > 0) {
        const sorted = [...event.organizers].sort((a, b) => a.position - b.position);
        for (const row of sorted) {
            const mapped = organizerRowToAttributed(row);
            if (mapped) return mapped;
        }
    }
    if (event.accounts) return legacyAccountToAttributed(event.accounts);
    return null;
}

/**
 * Co-presenters — additional organizing bodies (PizzaPy + JSCebu + AWSUG joint
 * event case). Empty for events with a single organizer or legacy-only data.
 */
export function getCoOrganizers(event: EventFromDB): AttributedOrganizer[] {
    if (!event.organizers || event.organizers.length <= 1) return [];
    return [...event.organizers]
        .sort((a, b) => a.position - b.position)
        .slice(1)
        .map(organizerRowToAttributed)
        .filter((o): o is AttributedOrganizer => o !== null);
}

/**
 * All known platform-presences of the event ("Presented by Luma · also on
 * Facebook · also on Meetup"). Falls back to a single synthesized link from
 * the legacy `event.source`/`event.ticket_url` for events that haven't been
 * re-ingested through the multi-source pipeline yet.
 */
export function getSourceLinks(event: EventFromDB): AttributedSourceLink[] {
    if (event.source_links && event.source_links.length > 0) {
        const primaryId = event.primary_source_link_id;
        return event.source_links
            .filter((link): link is EventSourceLinkRow => !!link?.source)
            .map((link) => ({
                source: link.source,
                display_name: labelForSource(link.source),
                url: link.url,
                is_canonical: primaryId != null && link.id === primaryId,
            }))
            // Canonical first, then the rest in insertion order.
            .sort((a, b) => Number(b.is_canonical) - Number(a.is_canonical));
    }

    // Legacy: synthesize one link from the event's flat source/ticket_url fields.
    if (event.source) {
        return [
            {
                source: event.source,
                display_name: labelForSource(event.source),
                url: event.ticket_url ?? null,
                is_canonical: true,
            },
        ];
    }
    return [];
}

/**
 * Convenience: which source is the canonical content source for this event?
 * Useful for the "Presented by … via Luma" header pattern.
 */
export function getCanonicalSource(event: EventFromDB): AttributedSourceLink | null {
    const links = getSourceLinks(event);
    return links.find((l) => l.is_canonical) ?? links[0] ?? null;
}

/** Non-canonical source links — for "also on …" rendering. */
export function getSecondarySourceLinks(event: EventFromDB): AttributedSourceLink[] {
    return getSourceLinks(event).filter((l) => !l.is_canonical);
}
