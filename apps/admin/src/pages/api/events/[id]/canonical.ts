import type { APIRoute } from 'astro';
import { supabase } from '../../../../lib/supabase';

export const prerender = false;

/**
 * Set the canonical (primary) source link for an event. Updates
 * events.primary_source_link_id and copies that source-link's name/description/
 * etc. into the events row. The next ingest from the chosen source will keep
 * overwriting canonical content; the next ingest from a non-canonical source
 * won't (per the source_priority rules in services/core).
 *
 * For now this implementation ONLY updates primary_source_link_id; content
 * fields stay as they were. Full content-recopy is a v3 enhancement.
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

    // Sanity-check: the link must belong to this event
    const { data: link, error: linkErr } = (await supabase
        .from('event_source_links')
        .select('id, event_id, source')
        .eq('id', linkId)
        .maybeSingle()) as unknown as {
        data: { id: number; event_id: number; source: string } | null;
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

    const { error } = await supabase
        .from('events')
        .update({ primary_source_link_id: linkId })
        .eq('id', eventId);

    if (error) {
        return redirect(
            `/events/${eventId}?flash=error&msg=` + encodeURIComponent(error.message),
            303,
        );
    }

    return redirect(
        `/events/${eventId}?flash=success&msg=` +
            encodeURIComponent(`Canonical source set to ${link.source}`),
        303,
    );
};
