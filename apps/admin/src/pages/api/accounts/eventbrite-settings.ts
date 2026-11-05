import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';

export const prerender = false;

/**
 * Change one watched Eventbrite organizer from the list on /orgs. Only
 * Eventbrite accounts can be changed here.
 *
 * Form fields:
 *   - account_id (required)
 *   - is_cebu_based  "true" | "false"  (optional)
 *   - is_active      "true" | "false"  (optional)
 */
const back = (flash: 'error' | 'success', msg: string) => '/orgs?flash=' + flash + '&msg=' + encodeURIComponent(msg);

const flag = (value: FormDataEntryValue | null): boolean | undefined =>
    value === 'true' ? true : value === 'false' ? false : undefined;

export const POST: APIRoute = async ({ request, redirect }) => {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return redirect(back('error', 'Invalid form data'), 303);
    }
    const accountId = formData.get('account_id')?.toString().trim() ?? '';
    const changes: { is_cebu_based?: boolean; is_active?: boolean } = {};
    const cebuBased = flag(formData.get('is_cebu_based'));
    const active = flag(formData.get('is_active'));
    if (cebuBased !== undefined) changes.is_cebu_based = cebuBased;
    if (active !== undefined) changes.is_active = active;
    if (!accountId || Object.keys(changes).length === 0) return redirect(back('error', 'Nothing to change'), 303);

    const { data, error } = await supabase
        .from('accounts')
        .update(changes)
        .eq('account_id', accountId)
        .eq('type', 'eventbrite')
        .select('name');
    if (error) return redirect(back('error', `Update failed: ${error.message}`), 303);
    if (!data?.length) return redirect(back('error', `No Eventbrite organizer ${accountId}`), 303);

    const said = [
        cebuBased === undefined ? null : cebuBased ? 'Cebu-based' : 'not Cebu-based',
        active === undefined ? null : active ? 'watched' : 'turned off',
    ].filter(Boolean).join(', ');
    return redirect(back('success', `"${data[0].name}" is now ${said}.`), 303);
};
