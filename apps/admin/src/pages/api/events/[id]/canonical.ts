import type { APIRoute } from 'astro';
import { supabase } from '../../../../lib/supabase';
import { recordEventAuditLog } from '../../../../lib/event-audit';
import {
    compactEventState,
    deriveCanonicalEventUpdate,
    type EventRowForContent,
    type SourceLinkForContent,
} from '../../../../lib/event-source-content';

export const prerender = false;

/**
 * Set the canonical source link for an event. This updates
 * events.primary_source_link_id and re-materializes the canonical event fields
 * from event_source_links.raw when that raw payload has normalized content.
 */
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

    const linkIdRaw = formData.get('source_link_id')?.toString().trim();
    if (!linkIdRaw) {
        return new Response('source_link_id is required', { status: 400 });
    }
    const linkId = parseInt(linkIdRaw, 10);
    if (Number.isNaN(linkId)) {
        return new Response('Invalid source_link_id', { status: 400 });
    }

    const { data: beforeEvent, error: beforeErr } = (await supabase
        .from('events')
        .select('id, name, description, start_time, end_time, timezone, location, location_details, cover_photo, city, region, country, primary_source_link_id')
        .eq('id', eventId)
        .maybeSingle()) as unknown as {
        data: EventRowForContent | null;
        error: { message: string } | null;
    };

    if (beforeErr || !beforeEvent) {
        return redirect(
            `/events/${eventId}?flash=error&msg=` +
                encodeURIComponent(beforeErr?.message ?? 'Event not found'),
            303,
        );
    }

    // Sanity-check: the link must belong to this event.
    const { data: link, error: linkErr } = (await supabase
        .from('event_source_links')
        .select('id, event_id, source, source_id, url, ingest_kind, scraped_at, raw')
        .eq('id', linkId)
        .maybeSingle()) as unknown as {
        data: SourceLinkForContent | null;
        error: { message: string } | null;
    };

    if (linkErr) {
        return redirect(
            `/events/${eventId}?flash=error&msg=` + encodeURIComponent(linkErr.message),
            303,
        );
    }
    if (!link || link.event_id !== eventId) {
        return redirect(
            `/events/${eventId}?flash=error&msg=` +
                encodeURIComponent('That source link does not belong to this event'),
            303,
        );
    }

    const update = deriveCanonicalEventUpdate(link, beforeEvent);
    const { data: afterEvent, error } = (await supabase
        .from('events')
        .update(update)
        .eq('id', eventId)
        .select('id, name, description, start_time, end_time, timezone, location, location_details, cover_photo, city, region, country, primary_source_link_id')
        .maybeSingle()) as unknown as {
        data: EventRowForContent | null;
        error: { message: string } | null;
    };

    if (error) {
        return redirect(
            `/events/${eventId}?flash=error&msg=` + encodeURIComponent(error.message),
            303,
        );
    }

    await recordEventAuditLog({
        eventId,
        action: 'canonical_source_changed',
        summary: `Canonical source set to ${link.source}`,
        before: {
            primary_source_link_id: beforeEvent.primary_source_link_id ?? null,
            event: compactEventState(beforeEvent),
        },
        after: {
            primary_source_link_id: linkId,
            event: compactEventState(afterEvent ?? beforeEvent),
        },
        metadata: {
            source_link_id: link.id,
            source: link.source,
            source_id: link.source_id,
            url: link.url,
            recopied_fields: Object.keys(update).filter((key) => key !== 'primary_source_link_id'),
        },
    });

    return redirect(
        `/events/${eventId}?flash=success&msg=` +
            encodeURIComponent(`Canonical source set to ${link.source} and event fields refreshed`),
        303,
    );
};
