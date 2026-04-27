import { supabase } from '../../shared/client.ts';
import { Event, EventSlugInsert, EventUpdate } from '../../shared/types.ts';
import { generateEventSlug } from './utils.ts';
import { geocodeLocation, looksLikeOnlineEvent } from '../../shared/geocode.ts';

export const getEventBySourceId = (sourceId: string) => {
    return supabase.from('events').select('*').eq('source_id', sourceId).single();
};

export const getAccountByName = (name: string) => {
    return supabase.from('accounts').select('*').eq('name', name).single();
};

/**
 * Updates the account_id for an event. This account id is used as the primary host for the event.
 *
 * @param eventId - The id of the event to update
 * @param accountId - The id of the account to update the event to
 * @returns The updated event
 */
export const updateEventAccountId = (eventId: number, accountId: number) => {
    return supabase.from('events').update({ account_id: accountId }).eq('id', eventId);
};

/**
 * Geocode `location` for events missing `location_details`. Fire-and-forget
 * pattern — call after `saveEvents` so newly ingested events get coordinates
 * automatically (no manual backfill ever needed for fresh data). Idempotent:
 * skips events that already have coords or whose location is an online marker.
 *
 * Reads GOOGLE_MAPS_KEY from Deno env. If unset, no-ops with a warning so
 * ingest never fails because of geocoding.
 */
export const geocodeEventLocations = async (events: Event[]): Promise<void> => {
    const key = Deno.env.get('GOOGLE_MAPS_KEY') ?? Deno.env.get('PUBLIC_GOOGLE_MAPS_KEY');
    if (!key) {
        console.warn('[geocode] GOOGLE_MAPS_KEY not set — skipping geocoding');
        return;
    }

    const todo = events.filter(
        (e) => e.location && !e.location_details && !looksLikeOnlineEvent(e.location),
    );
    if (todo.length === 0) return;

    console.log(`[geocode] processing ${todo.length} event${todo.length === 1 ? '' : 's'}`);

    // Sequential with a small gap. Ingest batches are typically tiny; we don't
    // need parallelism, and being polite to Google's free tier matters more
    // than a 200ms saving.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const event of todo) {
        const result = await geocodeLocation(event.location!, key);
        if (!result.ok) {
            console.warn(`[geocode] id=${event.id} ${result.reason} ← ${event.location}`);
            await sleep(125);
            continue;
        }
        const { error } = await supabase
            .from('events')
            .update({ location_details: { latitude: result.lat, longitude: result.lng } })
            .eq('id', event.id);
        if (error) {
            console.warn(`[geocode] id=${event.id} write failed: ${error.message}`);
        } else {
            console.log(`[geocode] id=${event.id} ✓ ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`);
        }
        await sleep(125);
    }
};

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
