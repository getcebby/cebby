// @ts-check
import { defineConfig } from "astro/config";
import AstroPWA from "@vite-pwa/astro";

import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
  integrations: [
    AstroPWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Cebby",
        short_name: "cebby",
        description: "Your local events companion",
        theme_color: "#ffffff",
        icons: [
          {
            src: "icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
      },
      workbox: {
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,webp,jpg,jpeg}",
          "offline.html",
        ],
        runtimeCaching: [
          {
            urlPattern: ({ request }) =>
              request.mode === "navigate" || request.destination === "document",
            handler: "NetworkFirst",
            options: {
              cacheName: "pages-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
              networkTimeoutSeconds: 3, // Fallback to cache if network is slow
            },
          },
          {
            urlPattern: /^https:\/\/qkhlgxdtodyyemkarouo\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /\.(png|jpg|jpeg|svg|gif)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "image-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
        ],
        navigationPreload: true,
        offlineGoogleAnalytics: true,
        sourcemap: true,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: "/offline.html",
        navigateFallbackAllowlist: [/^(?!\/(api|_)).*$/],
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
      },
      devOptions: {
        enabled: true,
        type: "module",
        navigateFallback: "/offline.html",
      },
      experimental: {
        directoryAndTrailingSlashHandler: true,
      },
    }),
    tailwind(),
  ],
});
