import { generateEventSlug } from '../utils.ts';
import { Tables } from '../../../shared/database.types.ts';
import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';

describe('generateEventSlug', () => {
    it('should generate a slug with normal title and id', () => {
        const event = {
            id: 123,
            name: 'My Test Event',
        } as Tables<'events'>;

        expect(generateEventSlug(event)).toBe('my-test-event--123');
    });

    it('should handle special characters in title', () => {
        const event = {
            id: 456,
            name: 'Test @ Event! With #Special$ Characters&',
        } as Tables<'events'>;

        expect(generateEventSlug(event)).toBe('test-event-with-special-characters--456');
    });

    it('should handle multiple spaces and trim', () => {
        const event = {
            id: 789,
            name: '  Multiple   Spaces   Test  ',
        } as Tables<'events'>;

        expect(generateEventSlug(event)).toBe('multiple-spaces-test--789');
    });

    it('should handle empty title (uses only id)', () => {
        const event = {
            id: 101,
            name: '',
        } as Tables<'events'>;

        expect(generateEventSlug(event)).toBe('101');
    });

    it('should handle undefined title', () => {
        const event = {
            id: 102,
            name: undefined,
        } as unknown as Tables<'events'>;

        expect(generateEventSlug(event)).toBe('102');
    });

    it('should handle non-latin characters', () => {
        const event = {
            id: 103,
            name: 'événement spécial 特別なイベント',
        } as Tables<'events'>;

        expect(generateEventSlug(event)).toBe('evenement-special--103');
    });

    it('should ensure title and id is separated with double hypens', () => {
        const event = {
            id: 103,
            name: 'Event 101',
        } as Tables<'events'>;
        const slug = generateEventSlug(event);
        const [title, id] = slug.split('--');

        expect(title).toBe('event-101');
        expect(id).toBe('103');
    });
});
