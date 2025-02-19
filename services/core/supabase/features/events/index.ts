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

    const slugs: EventSlugInsert[] =
        data?.map((event: Event) => ({
            slug: generateEventSlug(event),
            event_id: event.id,
        })) ?? [];

    if (slugs.length > 0) {
        await Promise.allSettled([
            supabase.from('event_slugs').upsert(slugs, { onConflict: 'slug' }),
            supabase.from('events').upsert(slugs.map(({ slug, event_id }) => ({ id: event_id, slug }))),
        ]);
    }
    console.log('🚀 ~ saveEvents ~ data:', data);

    return {
        data,
        error,
    };
};

// This takes cover_photo from the event and uploads it to supabase storage and update references in the events
// If it fails, it will by default use the event image
export const storeCoverImages = async (events: EventUpdate[]) => {
    const eventsWithUpdatedCoverImages = await Promise.all(
        events.map(async (event) => {
            try {
                if (!event.cover_photo) {
                    return null;
                }

                const response = await fetch(event.cover_photo);

                const blob = await response.blob();
                const fileType = blob.type.split('/')[1] || 'jpg';
                const fileName = `${generateEventSlug(event)}.${fileType}`;
                const storagePath = `images/events/${fileName}`;

                console.log('upload parameters', { blob, fileType, fileName, storagePath });

                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('images')
                    .upload(storagePath, blob, { upsert: true });

                if (uploadError) {
                    console.error(`Upload error for ${event.source_id}:`, uploadError);
                    return null;
                }

                const { data: urlData } = await supabase.storage.from('images').getPublicUrl(uploadData.path);
                if (!urlData.publicUrl) {
                    console.error(`Failed to get public URL for ${event.source_id}`);
                    return null;
                }

                return { cover_photo: urlData.publicUrl, source_id: event.source_id };
            } catch (error) {
                console.error(`Error processing event ${event.source_id}:`, error);
                return null;
            }
        }),
    );
    console.log('🚀 ~ storeCoverImages ~ coverImages:', eventsWithUpdatedCoverImages);

    const { data, error } = await supabase
        .from('events')
        .upsert(eventsWithUpdatedCoverImages?.filter(Boolean) ?? [], {
            onConflict: 'source_id',
        })
        .select();
    console.log('🚀 ~ storeCoverImages ~ data, error:', data, error);

    return {
        data,
        error,
        processedImages: eventsWithUpdatedCoverImages.filter(Boolean).length,
        totalImages: events.length,
    };
};
