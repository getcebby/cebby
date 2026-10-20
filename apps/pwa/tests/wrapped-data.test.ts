import { describe, expect, it, vi } from 'vitest';

const publicProfile = {
    id: 'profile-1',
    logto_user_id: 'logto-1',
    email: 'owner@example.com',
    name: 'Profile Owner',
    created_at: '2025-01-01T00:00:00Z',
};

vi.mock('astro:env/client', () => ({ PUBLIC_SUPABASE_URL: 'https://supabase.test' }));
vi.mock('astro:env/server', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'service-role' }));

// Every query builder call chains; `.single()` resolves the profile lookup and
// awaiting a list query resolves to no rows (a profile with no attended events).
vi.mock('@supabase/supabase-js', () => {
    const builder: any = new Proxy(
        {},
        {
            get(_target, prop) {
                if (prop === 'single') return () => Promise.resolve({ data: publicProfile, error: null });
                if (prop === 'then') {
                    return (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
                }
                return () => builder;
            },
        },
    );
    return { createClient: () => ({ from: () => builder }) };
});

const { GET } = await import('../src/pages/api/wrapped-data');

describe('GET /api/wrapped-data?profileId=', () => {
    it('does not expose the profile owner email on the public share view', async () => {
        const url = new URL('https://getcebby.com/api/wrapped-data?year=2025&profileId=profile-1');

        const response = await GET({ url, request: new Request(url) } as any);
        const body = (await response.json()) as { userName: string };

        expect(response.status).toBe(200);
        expect(body.userName).toBe('Profile Owner');
        expect(JSON.stringify(body)).not.toContain('owner@example.com');
    });
});
