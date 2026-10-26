import type { APIRoute } from 'astro';
import { supabase } from '../../../../lib/supabase';
import { recordEventAuditLog } from '../../../../lib/event-audit';
import { isTrustTier, trustTierLabel } from '../../../../lib/event-trust';

export const prerender = false;

function eventRedirect(
    redirect: (path: string, status?: 300 | 301 | 302 | 303 | 304 | 307 | 308) => Response,
    eventId: number,
    kind: 'success' | 'error',
    message: string,
) {
    return redirect(`/events/${eventId}?flash=${kind}&msg=${encodeURIComponent(message)}`, 303);
}

export const POST: APIRoute = async ({ params, request, redirect }) => {
    const idParam = params.id;
    const eventId = idParam ? parseInt(idParam, 10) : NaN;
    if (Number.isNaN(eventId)) {
        return new Response('Invalid event id', { status: 400 });
    }

    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return new Response('Invalid form data', { status: 400 });
    }

    const linkIdRaw = formData.get('source_link_id')?.toString().trim() ?? '';
    const linkId = parseInt(linkIdRaw, 10);
    if (Number.isNaN(linkId)) {
        return eventRedirect(redirect, eventId, 'error', 'Invalid source link');
    }

    const nextTierRaw = formData.get('trust_tier')?.toString().trim() ?? '';
    if (!isTrustTier(nextTierRaw)) {
        return eventRedirect(redirect, eventId, 'error', 'Invalid trust badge');
    }

    const { data: link, error: linkErr } = (await supabase
        .from('event_source_links')
        .select('id, event_id, source, source_id, url, ingest_kind')
        .eq('id', linkId)
        .maybeSingle()) as unknown as {
        data: {
            id: number;
            event_id: number;
            source: string;
            source_id: string;
            url: string | null;
            ingest_kind: string | null;
        } | null;
        error: { message: string } | null;
    };

    if (linkErr) {
        return eventRedirect(redirect, eventId, 'error', linkErr.message);
    }
    if (!link || link.event_id !== eventId) {
        return eventRedirect(redirect, eventId, 'error', 'That source link does not belong to this event');
    }

    const { data: eventRow } = (await supabase
        .from('events')
        .select('id, name, primary_source_link_id')
        .eq('id', eventId)
        .maybeSingle()) as unknown as {
        data: { id: number; name: string | null; primary_source_link_id: number | null } | null;
    };

    if (eventRow?.primary_source_link_id && eventRow.primary_source_link_id !== link.id) {
        return eventRedirect(redirect, eventId, 'error', 'Only the canonical source badge can be changed here');
    }

    // Lock the tier so rescrapes don't overwrite the operator's choice.
    const { error } = await supabase
        .from('event_source_links')
        .update({ ingest_kind: nextTierRaw, ingest_kind_locked: true })
        .eq('id', link.id);

    if (error) {
        return eventRedirect(redirect, eventId, 'error', error.message);
    }

    await recordEventAuditLog({
        eventId,
        action: 'trust_badge_changed',
        summary: `Trust badge set to ${trustTierLabel(nextTierRaw)}`,
        before: { source_link_id: link.id, ingest_kind: link.ingest_kind ?? null },
        after: { source_link_id: link.id, ingest_kind: nextTierRaw, ingest_kind_locked: true },
        metadata: {
            event_name: eventRow?.name ?? null,
            source: link.source,
            source_id: link.source_id,
            url: link.url,
        },
    });

    return eventRedirect(redirect, eventId, 'success', `Trust badge set to ${trustTierLabel(nextTierRaw)}`);
};
