import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import node from '@astrojs/node';

// Local-only operator tool. SSR via the Node adapter so HTTP basic auth in
// middleware can intercept every request. Portless publishes the dev server at
// https://cebby-admin.localhost:1355 (proxy pinned to 1355 in the dev script so
// it never needs sudo); 4322 remains the direct fallback port for dev:app.
export default defineConfig({
    output: 'server',
    adapter: node({ mode: 'standalone' }),
    server: {
        port: 4322,
        host: '127.0.0.1',
    },
    integrations: [tailwind()],
});
