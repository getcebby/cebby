import { Tables } from '../../shared/database.types.ts';

export const generateEventSlug = (event: Tables<'events'>): string => {
    const title = event.name
        ?.trim()
        .replace(/[^a-z0-9\s]+/gi, '')
        .replace(/\s+/g, '-');
    const slug = title ? `${title}-${event.id}` : String(event.id);
    return slug.toLowerCase();
};
