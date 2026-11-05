import { chooseCanonicalCover, coverSourceIdentity, generateEventSlug, hostedCoverKeyStem } from '../utils.ts';
import { Event } from '../../../shared/types.ts';
import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';

describe('generateEventSlug', () => {
    it('should generate a slug with normal title and id', () => {
        const event = {
            id: 123,
            name: 'My Test Event',
        } as Event;

        expect(generateEventSlug(event)).toBe('my-test-event--123');
    });

    it('should handle special characters in title', () => {
        const event = {
            id: 456,
            name: 'Test @ Event! With #Special$ Characters&',
        } as Event;

        expect(generateEventSlug(event)).toBe('test-event-with-special-characters--456');
    });

    it('should handle multiple spaces and trim', () => {
        const event = {
            id: 789,
            name: '  Multiple   Spaces   Test  ',
        } as Event;

        expect(generateEventSlug(event)).toBe('multiple-spaces-test--789');
    });

    it('should handle empty title (uses only id)', () => {
        const event = {
            id: 101,
            name: '',
        } as Event;

        expect(generateEventSlug(event)).toBe('101');
    });

    it('should handle undefined title', () => {
        const event = {
            id: 102,
            name: undefined,
        } as unknown as Event;

        expect(generateEventSlug(event)).toBe('102');
    });

    it('should handle non-latin characters', () => {
        const event = {
            id: 103,
            name: 'événement spécial 特別なイベント',
        } as Event;

        expect(generateEventSlug(event)).toBe('evenement-special--103');
    });

    it('should ensure title and id is separated with double hypens', () => {
        const event = {
            id: 103,
            name: 'Event 101',
        } as Event;
        const slug = generateEventSlug(event);
        const [title, id] = slug.split('--');

        expect(title).toBe('event-101');
        expect(id).toBe('103');
    });
});

// The same Facebook image, re-signed on two fetches: another CDN host and new query values.
const FB_A1 =
    'https://scontent-sin11-1.xx.fbcdn.net/v/t39.30808-6/466163389_1068_n.jpg?stp=dst-jpg_s960x960&_nc_cat=1&oh=00_AAA&oe=6911C1D3';
const FB_A2 =
    'https://scontent-sin2-1.xx.fbcdn.net/v/t39.30808-6/466163389_1068_n.jpg?stp=dst-jpg_s960x960&_nc_cat=7&oh=00_BBB&oe=6915A0F2';
// A different poster for the same event.
const FB_B = 'https://scontent-sin11-1.xx.fbcdn.net/v/t39.30808-6/471111111_2222_n.jpg?oh=00_CCC&oe=6915A0F2';
const R2 = 'https://images.getcebby.com';
const EVENT = { id: 271, slug: 'reactivate-24--271' };

describe('coverSourceIdentity', () => {
    it('names the image by its path, ignoring the CDN host and query', () => {
        expect(coverSourceIdentity(FB_A1)).toBe('/v/t39.30808-6/466163389_1068_n.jpg');
        expect(coverSourceIdentity(FB_A2)).toBe(coverSourceIdentity(FB_A1));
    });

    it('tells different images apart', () => {
        expect(coverSourceIdentity(FB_B)).not.toBe(coverSourceIdentity(FB_A1));
    });

    it('keeps a value that is not a URL as it is', () => {
        expect(coverSourceIdentity('not a url')).toBe('not a url');
    });
});

describe('hostedCoverKeyStem', () => {
    it('puts the event slug and a short hash of the source image under events/', async () => {
        expect(await hostedCoverKeyStem(EVENT, FB_A1)).toMatch(/^events\/reactivate-24--271-[0-9a-f]{12}$/);
    });

    it('gives a re-signed URL of the same image the same key', async () => {
        expect(await hostedCoverKeyStem(EVENT, FB_A2)).toBe(await hostedCoverKeyStem(EVENT, FB_A1));
    });

    it('gives a different image a different key', async () => {
        expect(await hostedCoverKeyStem(EVENT, FB_B)).not.toBe(await hostedCoverKeyStem(EVENT, FB_A1));
    });

    it('falls back to event-<id> when the event has no slug', async () => {
        expect(await hostedCoverKeyStem({ id: 9, slug: null }, FB_A1)).toMatch(/^events\/event-9-[0-9a-f]{12}$/);
    });
});

describe('chooseCanonicalCover', () => {
    const hostedCopyOf = async (url: string) => `${R2}/${await hostedCoverKeyStem(EVENT, url)}.jpg`;

    it('keeps the hosted cover when the source still has the same image', async () => {
        const current = await hostedCopyOf(FB_A1);
        expect(await chooseCanonicalCover({ ...EVENT, current, incoming: FB_A2, publicUrl: R2 })).toBe(current);
    });

    it('takes the source image when the poster changed', async () => {
        const current = await hostedCopyOf(FB_A1);
        expect(await chooseCanonicalCover({ ...EVENT, current, incoming: FB_B, publicUrl: R2 })).toBe(FB_B);
    });

    it('takes the source image over a hosted copy from before keys named the image', async () => {
        const current = `${R2}/events/reactivate-24--271.jpg`;
        expect(await chooseCanonicalCover({ ...EVENT, current, incoming: FB_A1, publicUrl: R2 })).toBe(FB_A1);
    });

    it('takes the source image when the event has no hosted cover yet', async () => {
        expect(await chooseCanonicalCover({ ...EVENT, current: FB_A1, incoming: FB_A2, publicUrl: R2 })).toBe(FB_A2);
        expect(await chooseCanonicalCover({ ...EVENT, current: null, incoming: FB_A1, publicUrl: R2 })).toBe(FB_A1);
    });

    it('takes the source image when covers are not hosted at all', async () => {
        const current = await hostedCopyOf(FB_A1);
        expect(await chooseCanonicalCover({ ...EVENT, current, incoming: FB_A2, publicUrl: null })).toBe(FB_A2);
    });
});
