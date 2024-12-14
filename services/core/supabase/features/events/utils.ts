import { Tables } from '../../shared/database.types.ts';

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

export const generateEventSlug = (event: Tables<'events'>): string => {
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
