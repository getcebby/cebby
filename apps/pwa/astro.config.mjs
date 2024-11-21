// @ts-check
import { defineConfig } from "astro/config";
import AstroPWA from "@vite-pwa/astro";
import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";
import pagefind from "astro-pagefind";

// https://astro.build/config
export default defineConfig({
  vite: {
    logLevel: "info",
    define: {
      __DATE__: `'${new Date().toISOString()}'`,
    },
    server: {
      fs: {
        // Allow serving files from hoisted root node_modules
        allow: ["../.."],
      },
    },
    ssr: {
      noExternal: ["html2canvas"],
    },
  },
  integrations: [
    AstroPWA({
      registerType: "prompt",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "mask-icon.svg"],
      manifest: {
        name: "Cebby",
        short_name: "cebby",
        description: "All tech events in Cebu in one place...",
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
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        start_url: "/",
        display: "standalone",
        background_color: "#8234E6",
        display_override: ["fullscreen", "minimal-ui"],
        shortcuts: [
          {
            name: "Events",
            url: "/events",
            icons: [{ src: "/icons/icon-192x192.png", sizes: "192x192" }],
          },
          {
            name: "Calendar",
            url: "/calendar",
            icons: [{ src: "/icons/icon-192x192.png", sizes: "192x192" }],
          },
        ],
        screenshots: [
          {
            src: "screenshots/desktop.png",
            sizes: "1920x1080",
            type: "image/png",
            form_factor: "wide",
            label: "Cebby Desktop View",
          },
          {
            src: "screenshots/desktop-calendar.png",
            sizes: "1920x1080",
            type: "image/png",
            form_factor: "wide",
            label: "Cebby Desktop Calendar View",
          },
          {
            src: "screenshots/mobile-calendar.png",
            sizes: "375x812",
            type: "image/png",
            form_factor: "narrow",
            label: "Cebby Mobile Calendar View",
          },
        ],
        protocol_handlers: [
          {
            protocol: "web+cebby",
            url: "/events?q=%s",
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
        clientsClaim: true,
        navigateFallback: "/",
        globPatterns: [
          // Limit to essential assets only
          "index.html",
          "manifest.webmanifest",
          "bg/**/*",
          "logo.svg",
          "icons/**/*",
          "**/*.{js,css}",
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => {
              const path = url.pathname;
              return path === "/" || path.startsWith("/event");
            },
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "pages-cache",
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
            urlPattern: ({ request }) => request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "images-cache",
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
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
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
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
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
            // Optimize API calls
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60, // 1 hour for API responses
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        navigateFallbackAllowlist: [/^\/($|event)/],
        suppressWarnings: true,
      },
      base: "/",
      strategies: "generateSW",
      experimental: {
        directoryAndTrailingSlashHandler: true,
      },
    }),
    tailwind(),
    sitemap(),
    pagefind(),
  ],
});
