/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
    readonly PUBLIC_SUPABASE_URL: string;
    readonly SUPABASE_SERVICE_ROLE_KEY: string;
    readonly ADMIN_PASSWORD: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
