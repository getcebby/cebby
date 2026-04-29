import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import node from '@astrojs/node';

// Local-only operator tool. SSR via the Node adapter so HTTP basic auth in
// middleware can intercept every request. The PWA runs on 4321; admin uses
// 4322 so both can run side-by-side via `pnpm dev` from each app dir.
export default defineConfig({
    output: 'server',
    adapter: node({ mode: 'standalone' }),
    server: {
        port: 4322,
        host: true,
    },
    integrations: [tailwind()],
});
