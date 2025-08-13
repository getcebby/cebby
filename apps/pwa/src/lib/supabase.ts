import { createClient } from '@supabase/supabase-js';
import type { Database } from '@service/core/supabase/shared/database.types.ts'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from 'astro:env/client';

export const supabase = createClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
