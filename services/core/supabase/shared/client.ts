import 'jsr:@std/dotenv/load';

import { Database } from './database.types.ts';
import { createClient } from 'jsr:@supabase/supabase-js';

export const supabaseUrl = Deno.env.get('SUPABASE_URL');
export const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !supabaseKey) {
    throw new Error(`Supabase URL or Key is missing: ${supabaseUrl}, ${supabaseKey}`);
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);

// Supabase clients
export const supabasePgmqSchemaClient = createClient(
    supabaseUrl,
    supabaseKey,
    { db: { schema: 'pgmq_public' } },
);
