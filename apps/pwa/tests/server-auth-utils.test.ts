import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserInfoFromToken } from '../src/lib/server-auth-utils';

// An unsigned token with attacker-chosen claims. Anyone can build one.
function forgeJwt(claims: Record<string, unknown>): string {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.not-a-signature`;
}

describe('getUserInfoFromToken', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('does not trust claims from a token that Logto rejects', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

        const user = await getUserInfoFromToken(forgeJwt({ sub: 'victim-id', email: 'victim@example.com' }));

        expect(user).toBeNull();
    });

    it('returns the user that Logto resolves the token to', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            Response.json({ sub: 'user-1', email: 'user@example.com', name: 'User One' }),
        );
        vi.stubGlobal('fetch', fetchMock);

        const user = await getUserInfoFromToken('opaque-access-token');

        expect(user).toEqual({ userId: 'user-1', userEmail: 'user@example.com', userName: 'User One' });
        expect(fetchMock).toHaveBeenCalledWith('https://auth.gocebby.com/oidc/me', {
            headers: { Authorization: 'Bearer opaque-access-token' },
        });
    });
});
