// @ts-check
import { defineConfig, envField } from 'astro/config';

import AstroPWA from '@vite-pwa/astro';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
    site: 'https://www.getcebby.com',
    output: 'server',
    adapter: cloudflare({
        imageService: 'cloudflare',
        platformProxy: {
            enabled: true,
        },
        routes: {
            extend: {
                exclude: [
                    { pattern: '/*.manifest' },
                    { pattern: '/workbox-*.js' },
                    { pattern: '/sw-*.js' },
                    { pattern: '/_worker.js' },
                ],
            },
        },
    }),
    vite: {
        logLevel: 'info',
        define: {
            __DATE__: `'${new Date().toISOString()}'`,
        },
        resolve: {
            alias: {
                crypto: 'crypto-browserify',
                stream: 'stream-browserify',
                events: 'events',
                path: 'path-browserify',
                url: 'url',
                util: 'util',
                buffer: 'buffer/',
                vm: 'vm-browserify',
                string_decoder: 'string_decoder',
            },
            conditions: ['browser', 'module', 'import', 'default'],
        },
        optimizeDeps: {
            exclude: [],
            include: ['jose'],
        },
        server: {
            fs: {
                // Allow serving files from hoisted root node_modules
                allow: ['../..'],
            },
        },
        ssr: {
            noExternal: ['ical-generator'],
            external: ['jose'],
        },
        build: {
            rollupOptions: {
                external: ['node:crypto', 'node:util', 'node:buffer'],
            },
        },
    },

    integrations: [
        AstroPWA({
            registerType: 'prompt',
            includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
            manifest: {
                name: 'Cebby',
                short_name: 'cebby',
                description: 'Discover all tech events in Cebu in one place...',
                theme_color: '#ffffff',
                icons: [
                    {
                        src: 'icons/icon-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: 'icons/icon-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: 'icons/icon-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
                start_url: '/',
                display: 'standalone',
                background_color: '#8234E6',
                display_override: ['fullscreen', 'minimal-ui'],
                screenshots: [
                    {
                        src: 'screenshots/image1.png',
                        sizes: '744x600',
                        type: 'image/png',
                        form_factor: 'wide',
                        label: 'Cebby',
                    },
                ],
                shortcuts: [
                    {
                        name: 'Events',
                        url: '/events',
                        icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192' }],
                    },
                    {
                        name: 'Calendar',
                        url: '/calendar',
                        icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192' }],
                    },
                ],
                protocol_handlers: [
                    {
                        protocol: 'web+cebby',
                        url: '/events?q=%s',
                    },
                ],
                // @todo: implement share target
                // share_target: {
                //   action: "/event-add",
                //   method: "POST",
                //   params: {
                //     url: "url",
                //   },
                // },
            },
            workbox: {
                maximumFileSizeToCacheInBytes: 3000000,
                skipWaiting: false,
                clientsClaim: false,
                globPatterns: ['**/*.{js,css,html,ico,txt,png,svg,webp,jpg,jpeg,gif,woff,woff2}'],
                globIgnores: ['**/_worker.js/**/*'],
                navigateFallback: null,
                runtimeCaching: [
                    // @note: In the future where we might benefit from always presenting up-to-date data, we'll use this
                    // Make sure to remove the "/" routes below
                    // {
                    //   urlPattern: ({ url, request }) => {
                    //     return url.pathname === "/" || url.pathname.endsWith("/");
                    //   },
                    //   handler: "NetworkFirst",
                    //   options: {
                    //     cacheName: "ssr-homepage-cache",
                    //     expiration: {
                    //       maxAgeSeconds: 60 * 60 * 1, // 1 hours
                    //     },
                    //     cacheableResponse: {
                    //       statuses: [0, 200],
                    //     },
                    //     networkTimeoutSeconds: 3, // Timeout if network is slow
                    //   },
                    // },
                    {
                        urlPattern: ({ url }) => {
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
                        },
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'ssr-pages-cache',
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                            expiration: {
                                maxEntries: 100,
                                maxAgeSeconds: 60 * 60 * 4, // 4 hours
                            },
                        },
                    },
                    {
                        urlPattern: ({ request }) => request.destination === 'image',
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'images-cache',
                            expiration: {
                                maxEntries: 100,
                                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    {
                        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'google-fonts-cache',
                            expiration: {
                                maxEntries: 10,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // <== 365 days
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    {
                        urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'gstatic-fonts-cache',
                            expiration: {
                                maxEntries: 10,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // <== 365 days
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                ],
            },
            devOptions: {
                enabled: true,
                type: 'module',
                navigateFallback: '/',
            },
            base: '/',
            strategies: 'generateSW',
            experimental: {
                directoryAndTrailingSlashHandler: true,
            },
        }),
        tailwind(),
    ],

    // Prefetch resources
    prefetch: {
        enabled: true,
        eagerness: 'moderate',
        strategy: 'viewport',
    },

    // Env
    env: {
        schema: {
            // Supabase
            PUBLIC_SUPABASE_URL: envField.string({ context: 'client', access: 'public' }),
            PUBLIC_SUPABASE_ANON_KEY: envField.string({ context: 'client', access: 'public' }),
            SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: 'server', access: 'public' }),
            
            // Typesense
            PUBLIC_TYPESENSE_HOST: envField.string({ context: 'client', access: 'public' }),
            PUBLIC_TYPESENSE_PORT: envField.string({ context: 'client', access: 'public', default: '8108' }),
            PUBLIC_TYPESENSE_PROTOCOL: envField.string({ context: 'client', access: 'public', default: 'https' }),
            PUBLIC_TYPESENSE_SEARCH_KEY: envField.string({ context: 'client', access: 'public' }),
            TYPESENSE_HOST: envField.string({ context: 'server', access: 'public', optional: true }),
            TYPESENSE_PORT: envField.string({ context: 'server', access: 'public', optional: true }),
            TYPESENSE_PROTOCOL: envField.string({ context: 'server', access: 'public', optional: true }),
            TYPESENSE_ADMIN_KEY: envField.string({ context: 'server', access: 'secret' }),
            
            // Google Maps
            PUBLIC_GOOGLE_MAPS_KEY: envField.string({ context: 'client', access: 'public' }),
            
            // Notion
            NOTION_API_KEY: envField.string({ context: 'server', access: 'secret' }),
            NOTION_DATABASE_ID: envField.string({ context: 'server', access: 'public' }),
            
            // Admin
            ADMIN_PASSWORD: envField.string({ context: 'server', access: 'secret' }),
        },
    },
});
