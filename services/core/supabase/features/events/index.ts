import { supabase } from '../../shared/client.ts';
import { Event, EventSlugInsert, EventUpdate } from '../../shared/types.ts';
import { generateEventSlug } from './utils.ts';

export const saveEvents = async (events: EventUpdate[]) => {
    const { data, error } = await supabase
        .from('events')
        .upsert(events, {
            onConflict: 'source_id',
        })
        .select();

    const slugs: EventSlugInsert[] = data?.map((event: Event) => ({
        slug: generateEventSlug(event),
        event_id: event.id,
    })) ?? [];

    if (slugs.length > 0) {
        await Promise.allSettled([
            supabase.from('event_slugs').upsert(slugs, { onConflict: 'slug' }),
            supabase.from('events').upsert(slugs.map(({ slug, event_id }) => ({ id: event_id, slug }))),
        ]);
    }

    return {
        data,
        error,
    };
};
