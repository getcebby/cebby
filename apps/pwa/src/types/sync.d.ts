declare interface SyncEvent extends Event {
    tag: string;
    lastChance: boolean;
    waitUntil(promise: Promise<any>): void;
}

declare interface ServiceWorkerGlobalScopeEventMap {
    sync: SyncEvent;
}

declare interface ServiceWorkerRegistration {
    sync: {
        register(tag: string): Promise<void>;
        getTags(): Promise<string[]>;
    };
}

declare interface SyncManager {
    register(tag: string): Promise<void>;
    getTags(): Promise<string[]>;
}
