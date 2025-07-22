export function validateEnvironment() {
    const requiredEnvVars = [
        'PUBLIC_SUPABASE_URL',
        'PUBLIC_SUPABASE_ANON_KEY'
    ];

    const missing = requiredEnvVars.filter(envVar => !import.meta.env[envVar]);
    
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

export const env = {
    SUPABASE_URL: import.meta.env.PUBLIC_SUPABASE_URL as string,
    SUPABASE_ANON_KEY: import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string,
    IS_DEV: import.meta.env.DEV as boolean,
    IS_PROD: import.meta.env.PROD as boolean,
} as const;