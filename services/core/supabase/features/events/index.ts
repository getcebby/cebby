import { supabase } from '../../shared/client.ts';
import { Tables } from '../../shared/database.types.ts';
import { generateEventSlug } from './utils.ts';

export const saveEvents = async (events: Tables<'events'>[]) => {
    const { data, error } = await supabase
        .from('events')
        .upsert(events, {
            onConflict: 'source_id',
        })
        .select();

    const slugs: Tables<'event_slugs'>[] =
        data?.map((event: Tables<'events'>) => ({
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
