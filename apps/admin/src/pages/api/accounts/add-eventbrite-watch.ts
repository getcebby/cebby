import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { parseEventbriteOrganizerInput, resolveEventbriteOrganizer } from '../../../lib/eventbrite-organizer';

export const prerender = false;

/**
 * Watch an Eventbrite organizer. POSTed from "Watch an Eventbrite organizer" on
 * /orgs. The cron (sync-eventbrite-accounts, :45 every 6h) reads every active
 * Eventbrite account. If the organizer is already watched, the form's Cebu-based
 * choice is applied to it.
 *
 * Form fields:
 *   - input (required)  organizer link (eventbrite.com/o/<slug>-<id>), bare id, or an event link
 *   - cebu_based        "on" when the organizer is based in Cebu (its online events then count)
 */
const back = (flash: 'error' | 'info' | 'success', msg: string) =>
    '/orgs?flash=' + flash + '&msg=' + encodeURIComponent(msg);

export const POST: APIRoute = async ({ request, redirect }) => {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return redirect(back('error', 'Invalid form data'), 303);
    }
    const cebuBased = formData.get('cebu_based') === 'on';
    const where = cebuBased ? 'Cebu-based' : 'not Cebu-based';

    const resolved = await resolveEventbriteOrganizer(
        parseEventbriteOrganizerInput(formData.get('input')?.toString() ?? ''),
    );
    if ('error' in resolved) return redirect(back('error', resolved.error), 303);

    const { data: existing, error: readErr } = await supabase
        .from('accounts')
        .select('account_id, name, type, is_active')
        .eq('account_id', resolved.organizerId)
        .maybeSingle();
    if (readErr) return redirect(back('error', `Lookup failed: ${readErr.message}`), 303);

    if (existing && existing.type !== 'eventbrite') {
        return redirect(
            back('error', `Id ${resolved.organizerId} already belongs to a ${existing.type} account ("${existing.name}").`),
            303,
        );
    }

    if (existing) {
        const { error } = await supabase
            .from('accounts')
            .update({ is_cebu_based: cebuBased })
            .eq('account_id', existing.account_id)
            .eq('type', 'eventbrite');
        if (error) return redirect(back('error', `Update failed: ${error.message}`), 303);
        return redirect(
            back('info', `Already watching "${existing.name}"${existing.is_active ? '' : ' (turned off)'}; now ${where}.`),
            303,
        );
    }

    const { error: insertErr } = await supabase.from('accounts').insert({
        account_id: resolved.organizerId,
        name: resolved.name,
        type: 'eventbrite',
        kind: 'eventbrite_organizer',
        is_active: true,
        is_cebu_based: cebuBased,
        account_details: { path: resolved.path, organizer_id: resolved.organizerId },
    });
    if (insertErr) return redirect(back('error', `Insert failed: ${insertErr.message}`), 303);

    return redirect(
        back('success', `Watching "${resolved.name}" (${where}). Its events are read at :45 every 6 hours.`),
        303,
    );
};
