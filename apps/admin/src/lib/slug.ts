import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Normalize a human name into a URL-safe slug: lowercase, ASCII letters/digits
 * and dashes only. Used when the operator creates an organization without
 * supplying a slug explicitly.
 */
export function slugify(input: string): string {
    return input
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}

/**
 * Pick a slug for a new organizations row that doesn't collide with any
 * existing slug. Tries the base first, then `<base>-2`, `<base>-3`, … up to a
 * sensible ceiling. The UNIQUE constraint on organizations.slug is still the
 * authoritative gate — this just gives the insert a fighting chance.
 */
export async function findUniqueOrgSlug(
    supabase: SupabaseClient,
    base: string,
): Promise<string> {
    const root = slugify(base) || 'org';
    for (let i = 1; i < 50; i++) {
        const candidate = i === 1 ? root : `${root}-${i}`;
        const { data } = await supabase
            .from('organizations')
            .select('id')
            .eq('slug', candidate)
            .maybeSingle();
        if (!data) return candidate;
    }
    // Extremely unlikely — 49 collisions in a row means something's off, but
    // a timestamp suffix still produces a valid unique slug.
    return `${root}-${Date.now()}`;
}
