// @ts-check
import { defineConfig } from 'astro/config';
import AstroPWA from '@vite-pwa/astro';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';

import cloudflare from '@astrojs/cloudflare';

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
                    { pattern: '/sitemap-*.xml' },
                    { pattern: '/sw-*.js' },
                    { pattern: '/workbox-*.js' },
                    { pattern: '/_astro/*' },
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
        server: {
            fs: {
                // Allow serving files from hoisted root node_modules
                allow: ['../..'],
            },
        },
        ssr: {
            noExternal: [],
        },
    },

    integrations: [
        AstroPWA({
            registerType: 'prompt',
            includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
            manifest: {
                name: 'Cebby',
                short_name: 'cebby',
                description: 'All tech events in Cebu in one place...',
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
        sitemap(),
    ],
});
