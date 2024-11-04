/// <reference lib="webworker" />

import { SyncQueueItem } from "./store/syncQueue";

declare const self: ServiceWorkerGlobalScope;

const SUPABASE_URL = "https://qkhlgxdtodyyemkarouo.supabase.co";

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-events") {
    event.waitUntil(syncEvents());
  }
});

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
  const request = await caches.open("sync-queue");
  const response = await request.match("queue");
  return response ? await response.json() : [];
}

async function removeFromQueue(id: string) {
  const queue = await getQueueFromStorage();
  const newQueue = queue.filter((item) => item.id !== id);
  const cache = await caches.open("sync-queue");
  await cache.put("queue", new Response(JSON.stringify(newQueue)));
}

async function getAuthToken(): Promise<string> {
  const cache = await caches.open("auth");
  const response = await cache.match("token");
  return response ? await response.text() : "";
}

async function getUserId(): Promise<string> {
  const cache = await caches.open("auth");
  const response = await cache.match("user_id");
  return response ? await response.text() : "";
}
