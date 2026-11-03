import { describe, expect, it } from 'vitest';
import { isCachedSsrPage } from '../src/pwa/ssr-page-cache.mjs';

const cached = (path: string) => isCachedSsrPage({ url: new URL(path, 'https://www.getcebby.com') });

describe('isCachedSsrPage', () => {
    it('serves the feed, calendar and event pages from the service worker cache', () => {
        expect(cached('/')).toBe(true);
        expect(cached('/events')).toBe(true);
        expect(cached('/events/some-event')).toBe(true);
        expect(cached('/calendar')).toBe(true);
        expect(cached('/partners/')).toBe(true);
    });

    it('never caches the status page, so a browser shows current checks or the 503', () => {
        expect(cached('/status')).toBe(false);
        expect(cached('/status/')).toBe(false);
    });
});
