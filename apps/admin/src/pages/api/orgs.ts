import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = false;

/**
 * Create a new organization. Form-encoded POST from /orgs.
 *
 * - `name` (required)
 * - `slug` (optional, [a-z0-9-]+)
 * - `source_priority` (optional, comma-separated list of source slugs)
 *
 * Redirects back to /orgs with a flash message on success or error so the
 * operator sees what happened without a separate notification system.
 */
export const POST: APIRoute = async ({ request, redirect }) => {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return redirect('/orgs?flash=error&msg=' + encodeURIComponent('Invalid form data'), 303);
    }

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

    if (!name) {
        return redirect('/orgs?flash=error&msg=' + encodeURIComponent('Name is required'), 303);
    }

    const { error } = await supabase.from('organizations').insert({
        name,
        slug,
        source_priority: sourcePriority,
        is_active: true,
    });

    if (error) {
        const msg =
            error.code === '23505'
                ? `An organization with that ${error.message.includes('slug') ? 'slug' : 'name'} already exists`
                : error.message;
        return redirect('/orgs?flash=error&msg=' + encodeURIComponent(msg), 303);
    }

    return redirect(
        '/orgs?flash=success&msg=' + encodeURIComponent(`Created "${name}"`),
        303,
    );
};
