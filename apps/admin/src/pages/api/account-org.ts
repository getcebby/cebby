import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = false;

/**
 * Assign an account to an organization (or unlink with empty value).
 * Form-encoded POST from /orgs.
 *
 * - `account_id` (required) — the platform-specific id, e.g. "107049890702460"
 *   or "cal-aRvpGAFjQUoFt3f"
 * - `organization_id` (optional, integer) — empty string = unlink
 */
export const POST: APIRoute = async ({ request, redirect }) => {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return redirect('/orgs?flash=error&msg=' + encodeURIComponent('Invalid form data'), 303);
    }

    const accountId = formData.get('account_id')?.toString().trim();
    const orgIdRaw = formData.get('organization_id')?.toString().trim() ?? '';

    if (!accountId) {
        return redirect(
            '/orgs?flash=error&msg=' + encodeURIComponent('account_id is required'),
            303,
        );
    }

    let organizationId: number | null = null;
    if (orgIdRaw.length > 0) {
        const parsed = parseInt(orgIdRaw, 10);
        if (Number.isNaN(parsed)) {
            return redirect(
                '/orgs?flash=error&msg=' + encodeURIComponent('Invalid organization_id'),
                303,
            );
        }
        organizationId = parsed;
    }

    const { error } = await supabase
        .from('accounts')
        .update({ organization_id: organizationId })
        .eq('account_id', accountId);

    if (error) {
        return redirect(
            '/orgs?flash=error&msg=' + encodeURIComponent(error.message),
            303,
        );
    }

    const msg = organizationId == null ? 'Account unlinked' : 'Account linked';
    return redirect('/orgs?flash=success&msg=' + encodeURIComponent(msg), 303);
};
