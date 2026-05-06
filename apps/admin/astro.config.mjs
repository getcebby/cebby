import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import node from '@astrojs/node';

// Local-only operator tool. SSR via the Node adapter so HTTP basic auth in
// middleware can intercept every request. Portless publishes the dev server at
// cebby-admin.localhost; 4322 remains the direct fallback port for dev:app.
export default defineConfig({
    output: 'server',
    adapter: node({ mode: 'standalone' }),
    server: {
        port: 4322,
        host: '127.0.0.1',
    },
    integrations: [tailwind()],
});
