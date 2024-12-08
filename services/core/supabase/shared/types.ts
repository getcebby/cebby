import type { Tables, TablesUpdate } from './database.types.ts';

export type Account = Tables<'accounts'>;

export type Event = Tables<'events'>;
export type EventUpdate = TablesUpdate<'events'>;

export type EventSlug = Tables<'event_slugs'>;
export type EventSlugUpdate = TablesUpdate<'event_slugs'>;
