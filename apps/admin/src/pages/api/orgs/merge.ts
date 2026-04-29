import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';

export const prerender = false;

/**
 * Create a new organization and link a set of accounts to it in one shot.
 * Designed for the "likely duplicates" cluster cards on /orgs — operator
 * confirms the cluster, hits one button, and the cluster collapses into a
 * single org with all accounts linked.
 *
 * Form fields:
 *   - org_name (required)
 *   - source_priority (optional; comma-separated)
 *   - account_ids (required; comma-separated platform account_ids)
 *
 * Done as two queries (insert org, update accounts) rather than a transaction
 * because PostgREST doesn't expose multi-statement transactions. If the
 * accounts update fails, the org row stays — operator can re-run, or unlink
 * individually. Acceptable for an admin tool.
 */
export const POST: APIRoute = async ({ request, redirect }) => {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return redirect('/orgs?flash=error&msg=' + encodeURIComponent('Invalid form data'), 303);
    }

    const orgName = formData.get('org_name')?.toString().trim();
    const accountIdsRaw = formData.get('account_ids')?.toString().trim() ?? '';
    const priorityRaw = formData.get('source_priority')?.toString().trim() ?? '';

    if (!orgName) {
        return redirect('/orgs?flash=error&msg=' + encodeURIComponent('org_name is required'), 303);
    }

    const accountIds = accountIdsRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    if (accountIds.length === 0) {
        return redirect(
            '/orgs?flash=error&msg=' + encodeURIComponent('At least one account_id is required'),
            303,
        );
    }

    const sourcePriority =
        priorityRaw.length > 0
            ? priorityRaw
                  .split(',')
                  .map((s) => s.trim().toLowerCase())
                  .filter((s) => s.length > 0)
            : null;

    // 1. Create the org
    const { data: created, error: insertErr } = await supabase
        .from('organizations')
        .insert({
            name: orgName,
            source_priority: sourcePriority,
            is_active: true,
        })
        .select('id')
        .single();

    if (insertErr || !created) {
        return redirect(
            '/orgs?flash=error&msg=' +
                encodeURIComponent(insertErr?.message ?? 'Failed to create organization'),
            303,
        );
    }

    // 2. Link all accounts
    const orgId = (created as { id: number }).id;
    const { error: linkErr, count } = await supabase
        .from('accounts')
        .update({ organization_id: orgId })
        .in('account_id', accountIds)
        .select('account_id', { count: 'exact', head: true });

    if (linkErr) {
        return redirect(
            '/orgs?flash=error&msg=' +
                encodeURIComponent(`Org created, but linking failed: ${linkErr.message}`),
            303,
        );
    }

    return redirect(
        '/orgs?flash=success&msg=' +
            encodeURIComponent(`Created "${orgName}" and linked ${count ?? accountIds.length} accounts`),
        303,
    );
};
