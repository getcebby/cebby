import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = false;

/**
 * Remove a single organizer from an event. Form-encoded POST from /events/[id].
 *   _action=remove
 *   event_id   (required, numeric)
 *   account_id (required, string)
 */
export const POST: APIRoute = async ({ request, redirect }) => {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return new Response('Invalid form data', { status: 400 });
    }

    const action = formData.get('_action')?.toString() ?? 'remove';
    const eventIdRaw = formData.get('event_id')?.toString().trim();
    const accountId = formData.get('account_id')?.toString().trim();

    if (!eventIdRaw || !accountId) {
        return new Response('event_id and account_id are required', { status: 400 });
    }
    const eventId = parseInt(eventIdRaw, 10);
    if (Number.isNaN(eventId)) {
        return new Response('Invalid event_id', { status: 400 });
    }

    if (action !== 'remove') {
        return new Response('Unknown _action', { status: 400 });
    }

    const { error } = await supabase
        .from('event_organizers')
        .delete()
        .eq('event_id', eventId)
        .eq('account_id', accountId);

    if (error) {
        return redirect(
            `/events/${eventId}?flash=error&msg=` + encodeURIComponent(error.message),
            303,
        );
    }

    return redirect(
        `/events/${eventId}?flash=success&msg=` + encodeURIComponent('Organizer removed'),
        303,
    );
};
