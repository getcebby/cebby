import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchEvents } = vi.hoisted(() => ({ searchEvents: vi.fn() }));
vi.mock('../src/lib/typesense', () => ({ searchEvents }));

const { GET } = await import('../src/pages/api/search');

function search(params: string) {
    return GET({ request: new Request(`https://getcebby.com/api/search?${params}`) } as any) as Promise<Response>;
}

describe('GET /api/search', () => {
    beforeEach(() => {
        searchEvents.mockReset();
        searchEvents.mockResolvedValue({ results: [], found: 0, search_time_ms: 1 });
    });

    it('lets shared caches store a successful search', async () => {
        const response = await search('q=ai');

        expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, stale-while-revalidate=300');
    });

    it('does not let shared caches store a failed search', async () => {
        // searchEvents catches Typesense errors itself and reports them in-band.
        searchEvents.mockResolvedValue({ results: [], found: 0, search_time_ms: 0, error: 'Typesense down' });

        const response = await search('q=ai');

        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toMatchObject({ error: 'Typesense down' });
    });

    it('falls back to default paging for non-numeric params', async () => {
        await search('q=ai&page=abc&per_page=xyz');

        expect(searchEvents).toHaveBeenCalledWith('ai', { page: 1, per_page: 20, upcoming: false });
    });

    it('passes deep page numbers through so paging ends on an empty page', async () => {
        await search('q=ai&page=150&per_page=100');

        expect(searchEvents).toHaveBeenCalledWith('ai', { page: 150, per_page: 100, upcoming: false });
    });

    it('caps per_page at 100', async () => {
        await search('q=ai&per_page=500');

        expect(searchEvents).toHaveBeenCalledWith('ai', { page: 1, per_page: 100, upcoming: false });
    });
});
