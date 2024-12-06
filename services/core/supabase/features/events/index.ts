import { supabase } from '../../shared/client.ts';
import { Event, EventSlugUpdate, EventUpdate } from '../../shared/types.ts';
import { generateEventSlug } from './utils.ts';

export const saveEvents = async (events: EventUpdate[]) => {
    const { data, error } = await supabase
        .from('events')
        .upsert(events, {
            onConflict: 'source_id',
        })
        .select();

    const slugs: EventSlugUpdate[] =
        data?.map((event: Event) => ({
            slug: generateEventSlug(event),
            event_id: event.id,
        })) ?? [];

    if (slugs.length > 0) {
        await supabase.from('event_slugs').upsert(slugs, {
            onConflict: 'slug',
        });
    }

    return {
        data,
        error,
    };
};
