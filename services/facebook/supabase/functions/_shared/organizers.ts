import { scrapeFbEventFromFbid } from 'npm:facebook-event-scraper';
import { FacebookCohost } from './types.ts';

export interface FacebookOrganizerHost {
    id: string;
    name: string;
    type?: string;
    url?: string;
    photoUrl?: string | null;
    source: 'public_host' | 'graph_owner' | 'graph_cohost';
}

export interface FacebookOrganizerResolution {
    hosts: FacebookOrganizerHost[];
    source: 'public_hosts' | 'graph_fallback';
}

interface FacebookGraphEventLike {
    id: string | number;
    cohosts?: { data: FacebookCohost[] } | FacebookCohost[];
}

export function isLikelyPage(host: { id?: string | number; type?: string; url?: string }): boolean {
    // pfbid... is FB's modern user-profile id format. Earlier versions of
    // this function ignored the id and only checked url shape, which let
    // through cohosts whose only signature was a pfbid id (no /profile.php
    // path, not pure-numeric). Result: 10 individuals got tagged as fb_page
    // and surfaced in event_organizers. Rejecting on id-prefix here is the
    // most reliable signal — even more so than the URL parse.
    if (typeof host.id === 'string' && host.id.startsWith('pfbid')) return false;

    if (host.type === 'Page') return true;
    if (!host.url) return false;
    const path = host.url.replace(/^https?:\/\/(www\.)?facebook\.com\//, '').split('?')[0].replace(/\/+$/, '');
    if (path.startsWith('profile.php')) return false;
    if (path.startsWith('pfbid')) return false;
    if (/^\d+$/.test(path)) return false;
    return true;
}

export function extractCohosts(event: FacebookGraphEventLike): FacebookCohost[] {
    if (!event.cohosts) return [];
    if (Array.isArray(event.cohosts)) return event.cohosts;
    return Array.isArray(event.cohosts.data) ? event.cohosts.data : [];
}

export function hostsFromPublicScrape(event: {
    hosts?: Array<{
        id?: string | number;
        name?: string;
        type?: string;
        url?: string;
        photo?: { url?: string; imageUri?: string } | null;
    }>;
}): FacebookOrganizerHost[] {
    return (event.hosts ?? [])
        .filter((host) => host.id != null && !!host.name && isLikelyPage(host))
        .map((host) => ({
            id: String(host.id),
            name: host.name!,
            type: host.type,
            url: host.url,
            photoUrl: host.photo?.imageUri ?? host.photo?.url ?? null,
            source: 'public_host' as const,
        }));
}

export async function resolvePublicOrganizerHosts(
    eventId: string,
): Promise<FacebookOrganizerHost[] | null> {
    try {
        const event = await scrapeFbEventFromFbid(eventId);
        return hostsFromPublicScrape(event);
    } catch (err) {
        console.warn(
            `[fb-organizers] public host scrape failed for ${eventId}: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
        return null;
    }
}

export function hostsFromGraph(event: FacebookGraphEventLike, account: { account_id: string; name: string }): FacebookOrganizerHost[] {
    const ownerId = String(account.account_id);
    const hosts: FacebookOrganizerHost[] = [
        {
            id: ownerId,
            name: account.name,
            source: 'graph_owner',
        },
    ];

    for (const cohost of extractCohosts(event)) {
        const cohostId = String(cohost.id);
        if (!cohostId || !cohost.name || cohostId === ownerId) continue;
        hosts.push({
            id: cohostId,
            name: cohost.name,
            source: 'graph_cohost',
        });
    }

    return hosts;
}

export async function resolveFacebookOrganizerHosts(
    event: FacebookGraphEventLike,
    account: { account_id: string; name: string },
): Promise<FacebookOrganizerResolution> {
    const publicHosts = await resolvePublicOrganizerHosts(String(event.id));
    if (publicHosts && publicHosts.length > 0) {
        return { hosts: publicHosts, source: 'public_hosts' };
    }

    return {
        hosts: hostsFromGraph(event, account),
        source: 'graph_fallback',
    };
}
