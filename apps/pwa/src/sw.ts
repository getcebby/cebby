/// <reference lib="webworker" />
/// <reference path="./types/sync.d.ts" />

import type { SyncQueueItem } from "./store/syncQueue";

declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = "v1.1.0"; // Update this when making cache-breaking changes

// Cache names with versions
const CACHES = {
  static: `static-${CACHE_VERSION}`,
  dynamic: `dynamic-${CACHE_VERSION}`,
  auth: `auth-${CACHE_VERSION}`,
  sync: `sync-${CACHE_VERSION}`,
  pages: `pages-${CACHE_VERSION}`,
};

// Immediately claim clients and take control
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((keys) => {
        return Promise.all(
          keys
            .filter((key) => !Object.values(CACHES).includes(key))
            .map((key) => {
              console.log("Deleting old cache:", key);
              return caches.delete(key);
            })
        );
      }),
      // Take control of all clients
      self.clients.claim(),
    ])
  );
});

// Listen for the skip waiting message
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    console.log("Skip waiting message received");
    // Skip waiting and notify clients
    self.skipWaiting().then(() => {
      // Notify all clients about the update
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: "SW_UPDATED",
            version: CACHE_VERSION,
          });
        });
      });
    });
  }
});

// Client driven requests
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "REQUEST_UPDATE") {
    self.registration.update();
  }
});

// Fallback, to periodically check for updates
setInterval(
  () => {
    self.registration.update();
  },
  60 * 60 * 1000
); // Check every hour

// Cache pages on fetch
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Check if the request is for the homepage or events route
  if (url.pathname === "/" || url.pathname.startsWith("/events/")) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return (
          cachedResponse ||
          fetch(event.request).then((response) => {
            return caches.open(CACHES.pages).then((cache) => {
              cache.put(event.request, response.clone());
              return response;
            });
          })
        );
      })
    );
  }
});
