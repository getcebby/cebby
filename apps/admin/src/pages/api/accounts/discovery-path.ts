import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';

export const prerender = false;

/**
 * Set or clear an account's discovery_path. Form-encoded POST from /orgs.
 *
 * - `account_id` (required) — the platform-specific id
 * - `path` (optional) — Luma path, URL, or empty string to clear
 */
export const POST: APIRoute = async ({ request, redirect }) => {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return redirect('/orgs?flash=error&msg=' + encodeURIComponent('Invalid form data'), 303);
    }

    const accountId = formData.get('account_id')?.toString().trim();
    const rawPath = formData.get('path')?.toString().trim() ?? '';

    if (!accountId) {
        return redirect(
            '/orgs?flash=error&msg=' + encodeURIComponent('account_id is required'),
            303,
        );
    }

    // Validate account exists (start with Luma accounts or any type)
    const { data: account, error: fetchError } = await supabase
        .from('accounts')
        .select('account_id, type, kind, name, account_details')
        .eq('account_id', accountId)
        .maybeSingle();

    if (fetchError) {
        return redirect(
            '/orgs?flash=error&msg=' + encodeURIComponent(fetchError.message),
            303,
        );
    }

    if (!account) {
        return redirect(
            '/orgs?flash=error&msg=' + encodeURIComponent('Account not found'),
            303,
        );
    }

    // Normalize input: accept full luma.com URL, vanity slug, user/<handle>, or calendar/cal-...
    // Store the bare path with host stripped
    let normalizedPath: string | null = null;
    if (rawPath.length > 0) {
        normalizedPath = rawPath
            .replace(/^https?:\/\//i, '')
            .replace(/^lu\.ma\//i, '')
            .replace(/^luma\.com\//i, '')
            .replace(/^\/+/, '')
            .replace(/[?#].*$/, '')
            .replace(/\/+$/, '');
    }

    // Update discovery_path and keep account_details.path in sync
    const accountDetails = (account.account_details as Record<string, unknown> | null) ?? {};
    if (normalizedPath) {
        accountDetails.path = normalizedPath;
    } else {
        delete accountDetails.path;
    }

    const { error: updateError } = await supabase
        .from('accounts')
        .update({
            discovery_path: normalizedPath,
            account_details: accountDetails,
        })
        .eq('account_id', accountId);

    if (updateError) {
        return redirect(
            '/orgs?flash=error&msg=' + encodeURIComponent(updateError.message),
            303,
        );
    }

    const msg = normalizedPath
        ? `Discovery path set to "${normalizedPath}"`
        : 'Discovery path cleared';
    return redirect('/orgs?flash=success&msg=' + encodeURIComponent(msg), 303);
};
