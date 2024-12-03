import '@std/dotenv/load';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { Database } from './database.types.ts';

export const supabaseUrl = Deno.env.get('SUPABASE_URL');
export const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !supabaseKey) {
    throw new Error(`Supabase URL or Key is missing: ${supabaseUrl}, ${supabaseKey}`);
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
console.log('🚀 ~ supabase:', supabase);
