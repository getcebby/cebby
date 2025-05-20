import { EventData, scrapeFbEvent } from 'facebook-event-scraper';
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next';

import { EventFromDB } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/utils/supabase/api';

type Data = {
    success: boolean;
    data?: EventData;
    message?: string;
    error?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }

        let eventData;

        try {
            eventData = await scrapeFbEvent(url);
            console.log(eventData);
        } catch (err) {
            console.error(err);
        }

        if (!eventData) {
            return res.status(400).json({ success: false, error: 'Event not found' });
        }

        // Now, let's save this event to the database
        const supabaseAdmin = createAdminClient(req, res);
        const supabaseEvent = await supabaseAdmin
            .from('events')
            .upsert(mapEventData(eventData), {
                onConflict: 'source_id',
            })
            .select()
            .single();
        console.log('🚀 ~ supabaseEvent ~ supabaseEvent:', supabaseEvent);

        // Generate slug
        const slug = await generateEventSlug(supabaseEvent?.data);
        await supabaseAdmin.from('event_slugs').upsert(
            {
                slug,
                event_id: supabaseEvent.data?.id,
            },
            {
                onConflict: 'slug',
            },
        );

        // Update slug field in the event
        await supabaseAdmin.from('events').update({ slug }).eq('id', supabaseEvent.data?.id);

        // Upload cover photo
        const coverPhotoUpdate = await uploadCoverPhoto({
            event: supabaseEvent.data,
            slug,
            supabaseClient: supabaseAdmin,
        });
        console.log('🚀 ~ coverPhotoUpdate ~ coverPhotoUpdate:', coverPhotoUpdate);

        return res.status(200).json({
            success: true,
            data: eventData,
            message: 'Event added successfully',
        });
    } catch (error) {
        console.error('Error adding event:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to add event',
        });
    }
}

async function uploadCoverPhoto({
    event,
    slug,
    supabaseClient: supabase,
}: {
    event: EventFromDB;
    slug: string;
    supabaseClient: SupabaseClient;
}) {
    if (!event.cover_photo) return null;

    const response = await fetch(event.cover_photo);

    const blob = await response.blob();
    const fileType = blob.type.split('/')[1] || 'jpg';
    const fileName = `${slug}.${fileType}`;
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

    return supabase.from('events').update({ cover_photo: urlData.publicUrl }).eq('id', event.id);
}

const transliterationMap: { [key: string]: string } = {
    á: 'a',
    à: 'a',
    ã: 'a',
    â: 'a',
    ä: 'a',
    é: 'e',
    è: 'e',
    ê: 'e',
    ë: 'e',
    í: 'i',
    ì: 'i',
    î: 'i',
    ï: 'i',
    ó: 'o',
    ò: 'o',
    õ: 'o',
    ô: 'o',
    ö: 'o',
    ú: 'u',
    ù: 'u',
    û: 'u',
    ü: 'u',
    ý: 'y',
    ÿ: 'y',
    ñ: 'n',
    ç: 'c',
};

const generateEventSlug = (event: EventData): string => {
    if (!event.name) return String(event.id);

    const transliterated = event.name
        .toLowerCase()
        .split('')
        .map((char) => transliterationMap[char] || char)
        .join('');

    const title = transliterated
        .trim()
        .replace(/[^a-z0-9\s]+/gi, '')
        .replace(/\s+/g, '-')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '');

    return `${title}--${event.id}`.toLowerCase();
};

function mapEventData(eventData: EventData): Omit<EventFromDB, 'id'> {
    return {
        name: eventData.name,
        description: eventData.description,
        start_time: new Date(eventData.startTimestamp * 1000).toISOString(),
        end_time: eventData.endTimestamp ? new Date(eventData.endTimestamp * 1000).toISOString() : undefined,
        is_facebook_pages: true,
        source: 'facebook',
        source_id: eventData.id,
        cover_photo: eventData.photo?.imageUri,
        location: eventData.location?.name,
        is_featured: false,
    };
}
