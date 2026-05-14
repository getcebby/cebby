import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { parseFbInput } from '../../../lib/fb-input';

export const prerender = false;

/**
 * Create a public-scrape watch entry for a Facebook page/profile. POSTed
 * from the "Watch a Facebook page" form on /orgs. Idempotent: if the slug
 * already exists as an accounts row (slug-keyed OR linked via
 * discovery_path), redirect with an info flash explaining the state.
 *
 * Form fields:
 *   - input (required)  free text: slug | @slug | full URL | numeric profile id
 */
export const POST: APIRoute = async ({ request, redirect }) => {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return redirect('/orgs?flash=error&msg=' + encodeURIComponent('Invalid form data'), 303);
    }

    const raw = formData.get('input')?.toString() ?? '';
    const parsed = parseFbInput(raw);
    if ('error' in parsed) {
        return redirect('/orgs?flash=error&msg=' + encodeURIComponent(parsed.error), 303);
    }

    const { slug, shape } = parsed;

    // Already exists as a slug-keyed row?
    const { data: byAccountId } = await supabase
        .from('accounts')
        .select('account_id, name, ingest_kind, is_active')
        .eq('account_id', slug)
        .maybeSingle();
    if (byAccountId) {
        const tier = byAccountId.ingest_kind ?? 'unknown';
        return redirect(
            '/orgs?flash=info&msg=' +
                encodeURIComponent(
                    `Already in accounts: "${byAccountId.name}" (${tier}${byAccountId.is_active ? '' : ', inactive'}).`,
                ),
            303,
        );
    }

    // Already covered by some other row that lists this slug as discovery_path?
    const { data: byDiscovery } = await supabase
        .from('accounts')
        .select('account_id, name, ingest_kind')
        .eq('type', 'facebook')
        .eq('discovery_path', slug)
        .maybeSingle();
    if (byDiscovery) {
        return redirect(
            '/orgs?flash=info&msg=' +
                encodeURIComponent(
                    `Already watched via account ${byDiscovery.account_id} ("${byDiscovery.name}", ${byDiscovery.ingest_kind ?? 'unknown'}).`,
                ),
            303,
        );
    }

    // Insert. name = slug acts as a placeholder that the cron's metadata
    // alignment will replace with the FB display name on the first
    // successful scrape.
    const { error: insertErr } = await supabase.from('accounts').insert({
        account_id: slug,
        name: slug,
        type: 'facebook',
        kind: 'fb_page',
        discovery_path: slug,
        ingest_kind: 'public_scrape',
        is_active: true,
    });
    if (insertErr) {
        return redirect(
            '/orgs?flash=error&msg=' +
                encodeURIComponent(`Insert failed: ${insertErr.message}`),
            303,
        );
    }

    return redirect(
        '/orgs?flash=success&msg=' +
            encodeURIComponent(
                `Now watching ${shape === 'numeric-profile' ? 'profile' : '@' + slug} — first scrape lands on the next cron tick (every 6h at :30 UTC).`,
            ),
        303,
    );
};
