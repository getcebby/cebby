import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { recordEventAuditLog } from '../../lib/event-audit';

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

    const { data: organizer } = (await supabase
        .from('event_organizers')
        .select('event_id, account_id, role, position, accounts(name, type, kind, organization_id)')
        .eq('event_id', eventId)
        .eq('account_id', accountId)
        .maybeSingle()) as unknown as {
        data: {
            event_id: number;
            account_id: string;
            role: string | null;
            position: number | null;
            accounts: { name: string | null; type: string | null; kind: string | null; organization_id: number | null } | null;
        } | null;
    };

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

    await recordEventAuditLog({
        eventId,
        action: 'organizer_removed',
        summary: `Removed organizer ${organizer?.accounts?.name ?? accountId}`,
        before: organizer ?? { event_id: eventId, account_id: accountId },
        after: { removed: true },
        metadata: { account_id: accountId },
    });

    return redirect(
        `/events/${eventId}?flash=success&msg=` + encodeURIComponent('Organizer removed'),
        303,
    );
};
