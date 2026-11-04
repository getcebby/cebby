// Which server-rendered pages the service worker serves stale-while-revalidate
// (astro.config.mjs, runtimeCaching). Workbox copies this function's source
// into the generated sw.js, so it must not use anything outside its own body.
export function isCachedSsrPage({ url }) {
    // /status reports live health: a stale copy could show "All working" during
    // an outage. Its own Cache-Control (60s, or no-store on a 503) governs it.
    if (url.pathname === '/status' || url.pathname === '/status/') return false;
    return (
        // Remove these routes when you're implementing "NetworkFirst" in the future
        url.pathname === '/' ||
        url.pathname.endsWith('/') ||
        url.pathname.endsWith('/events') ||
        //
        // Default routes
        url.pathname.startsWith('/calendar') ||
        url.pathname.startsWith('/events/')
    );
}
