/// <reference lib="webworker" />
/// <reference path="./types/sync.d.ts" />

import type { SyncQueueItem } from "./store/syncQueue";

declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = "v1.0.0"; // Update this when making cache-breaking changes
const SUPABASE_URL = "https://qkhlgxdtodyyemkarouo.supabase.co";

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

// Periodically check for updates
setInterval(
  () => {
    self.registration.update();
  },
  60 * 60 * 1000
); // Check every hour

self.addEventListener("sync", ((event: SyncEvent) => {
  if (event.tag === "sync-events") {
    event.waitUntil(syncEvents());
  }
}) as EventListener);

async function syncEvents() {
  const queue = await getQueueFromStorage();
  if (!queue.length) return;

  for (const item of queue) {
    try {
      await processQueueItem(item);
      await removeFromQueue(item.id);
    } catch (error) {
      console.error("Sync failed for item:", item, error);
      // Keep item in queue for retry
    }
  }
}

async function processQueueItem(item: SyncQueueItem) {
  const token = await getAuthToken();

  const response = await fetch(`${SUPABASE_URL}/rest/v1/saved_events`, {
    method: item.action === "save" ? "POST" : "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
    },
    body:
      item.action === "save"
        ? JSON.stringify({
            event_id: item.eventId,
            user_id: await getUserId(),
          })
        : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to ${item.action} event`);
  }

  // Notify the client about the successful sync
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({
      type: "SYNC_COMPLETE",
      item,
    });
  });
}

async function getQueueFromStorage(): Promise<SyncQueueItem[]> {
  const request = await caches.open(CACHES.sync);
  const response = await request.match("queue");
  return response ? await response.json() : [];
}

async function removeFromQueue(id: string) {
  const queue = await getQueueFromStorage();
  const newQueue = queue.filter((item) => item.id !== id);
  const cache = await caches.open(CACHES.sync);
  await cache.put("queue", new Response(JSON.stringify(newQueue)));
}

async function getAuthToken(): Promise<string> {
  const cache = await caches.open(CACHES.auth);
  const response = await cache.match("token");
  return response ? await response.text() : "";
}

async function getUserId(): Promise<string> {
  const cache = await caches.open(CACHES.auth);
  const response = await cache.match("user_id");
  return response ? await response.text() : "";
}
