import type { Tables, TablesInsert, TablesUpdate } from './database.types.ts';

export type Account = Tables<'accounts'>;

export type Event = Tables<'events'>;
export type EventUpdate = TablesUpdate<'events'>;

export type EventSlug = Tables<'event_slugs'>;
export type EventSlugInsert = TablesInsert<'event_slugs'>;
export type EventSlugUpdate = TablesUpdate<'event_slugs'>;

export interface QueueMessage<T> {
    msg_id: string;
    read_ct: number;
    enqueued_at: string;
    vt: string;
    message: T;
}
