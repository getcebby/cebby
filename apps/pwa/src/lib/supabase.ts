import { createClient } from '@supabase/supabase-js';
import type { Database } from '@service/core/supabase/shared/database.types.ts'
import { env, validateEnvironment } from '../utils/env';

// Validate environment variables on module load
validateEnvironment();

export const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
