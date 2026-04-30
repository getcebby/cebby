import { createClient } from '@supabase/supabase-js';

// Service-role client — admin operations need write access to all tables.
// Safe because this app runs locally for the operator only; the service-role
// key never reaches the browser (every fetch is in Astro's server context).
const url = import.meta.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
    throw new Error(
        'Missing Supabase config: set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/admin/.env',
    );
}

export const supabase = createClient(url, serviceRoleKey, {
    auth: {
        // No session persistence needed — admin app is request/response only.
        persistSession: false,
        autoRefreshToken: false,
    },
});
