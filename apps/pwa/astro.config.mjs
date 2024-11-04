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
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,jpg,jpeg}"],
        runtimeCaching: [
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
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
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
        navigationFallback: {
          htmlFileName: "/offline.html",
          matches: [/^(?!.*\.(js|css|json|png|jpg|jpeg|gif|webp|svg|ico)).*$/],
        },
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
      experimental: {
        directoryAndTrailingSlashHandler: true,
      },
    }),
    tailwind(),
  ],
});
