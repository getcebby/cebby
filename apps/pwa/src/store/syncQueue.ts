export interface SyncQueueItem {
  id: string;
  action: "save" | "unsave";
  eventId: string;
  timestamp: number;
}

const SYNC_QUEUE_KEY = "sync-queue";

export function addToSyncQueue(item: Omit<SyncQueueItem, "id" | "timestamp">) {
  const queue = getSyncQueue();
  const newItem: SyncQueueItem = {
    ...item,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  queue.push(newItem);
  saveSyncQueue(queue);
  triggerSync();
}

export function getSyncQueue(): SyncQueueItem[] {
  if (typeof localStorage === "undefined") return [];
  const queue = localStorage.getItem(SYNC_QUEUE_KEY);
  return queue ? JSON.parse(queue) : [];
}

export function saveSyncQueue(queue: SyncQueueItem[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

export function removeFromSyncQueue(id: string) {
  const queue = getSyncQueue();
  const newQueue = queue.filter((item) => item.id !== id);
  saveSyncQueue(newQueue);
}

async function triggerSync() {
  if ("serviceWorker" in navigator && navigator.onLine) {
    const registration = await navigator.serviceWorker.ready;
    await registration.sync.register("sync-events");
  }
}
