import type { APIRoute } from 'astro';
import { supabase } from '../../../../lib/supabase';
import { recordEventAuditLog } from '../../../../lib/event-audit';

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

    const action = formData.get('_action')?.toString() ?? '';
    const nextStatus = action === 'hide' ? 'hidden' : action === 'publish' ? 'published' : null;

    if (!nextStatus) {
        return new Response('Unknown _action', { status: 400 });
    }

    const { data: beforeEvent } = (await supabase
        .from('events')
        .select('id, name, status')
        .eq('id', eventId)
        .maybeSingle()) as unknown as {
        data: { id: number; name: string | null; status: string | null } | null;
    };

    const { error } = await supabase
        .from('events')
        .update({ status: nextStatus })
        .eq('id', eventId);

    if (error) {
        return eventRedirect(redirect, eventId, 'error', error.message);
    }

    await recordEventAuditLog({
        eventId,
        action: 'status_changed',
        summary: nextStatus === 'hidden' ? 'Event hidden from public PWA' : 'Event published again',
        before: { status: beforeEvent?.status ?? null },
        after: { status: nextStatus },
        metadata: { event_name: beforeEvent?.name ?? null, form_action: action },
    });

    return eventRedirect(
        redirect,
        eventId,
        'success',
        nextStatus === 'hidden' ? 'Event hidden from the public PWA' : 'Event published again',
    );
};
