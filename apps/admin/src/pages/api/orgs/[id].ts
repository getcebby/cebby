import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';

export const prerender = false;

/**
 * Update or delete a single organization. Form-encoded POST from /orgs/[id].
 * Uses a hidden `_action` field to multiplex update/delete on one endpoint
 * because HTML forms can't natively send PATCH or DELETE.
 *
 *   _action=update → reads name, slug, source_priority, is_individual, is_active
 *   _action=delete → drops the row; FK is ON DELETE SET NULL on accounts.organization_id
 */
export const POST: APIRoute = async ({ params, request, redirect }) => {
    const idParam = params.id;
    const id = idParam ? parseInt(idParam, 10) : NaN;
    if (Number.isNaN(id)) {
        return new Response('Invalid org id', { status: 400 });
    }

    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return redirect(`/orgs/${id}?flash=error&msg=` + encodeURIComponent('Invalid form data'), 303);
    }

    const action = formData.get('_action')?.toString();

    if (action === 'delete') {
        const { error } = await supabase.from('organizations').delete().eq('id', id);
        if (error) {
            return redirect(
                `/orgs/${id}?flash=error&msg=` + encodeURIComponent(error.message),
                303,
            );
        }
        return redirect('/orgs?flash=success&msg=' + encodeURIComponent('Organization deleted'), 303);
    }

    if (action === 'update') {
        const name = formData.get('name')?.toString().trim();
        const slugRaw = formData.get('slug')?.toString().trim() ?? '';
        const slug = slugRaw.length > 0 ? slugRaw : null;
        const priorityRaw = formData.get('source_priority')?.toString().trim() ?? '';
        const sourcePriority =
            priorityRaw.length > 0
                ? priorityRaw
                      .split(',')
                      .map((s) => s.trim().toLowerCase())
                      .filter((s) => s.length > 0)
                : null;
        const isIndividual = formData.get('is_individual')?.toString() === 'true';
        const isActive = formData.get('is_active')?.toString() === 'true';

        if (!name) {
            return redirect(
                `/orgs/${id}?flash=error&msg=` + encodeURIComponent('Name is required'),
                303,
            );
        }

        const { error } = await supabase
            .from('organizations')
            .update({
                name,
                slug,
                source_priority: sourcePriority,
                is_individual: isIndividual,
                is_active: isActive,
            })
            .eq('id', id);

        if (error) {
            return redirect(
                `/orgs/${id}?flash=error&msg=` + encodeURIComponent(error.message),
                303,
            );
        }

        return redirect(
            `/orgs/${id}?flash=success&msg=` + encodeURIComponent('Saved'),
            303,
        );
    }

    return new Response('Unknown _action', { status: 400 });
};
