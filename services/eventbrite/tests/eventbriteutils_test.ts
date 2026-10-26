import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { parseEventbriteEventUrl } from '../supabase/functions/_shared/eventbriteutils.ts';

describe('parseEventbriteEventUrl', () => {
    it('parses slugged and bare event URLs to the eventbrite.com canonical URL', () => {
        expect(parseEventbriteEventUrl('https://www.eventbrite.com/e/aicd-cebu-tickets-1993845961945')).toEqual({
            eventId: '1993845961945',
            canonicalUrl: 'https://www.eventbrite.com/e/1993845961945',
        });
        expect(parseEventbriteEventUrl('https://www.eventbrite.com/e/1234567890/')?.eventId).toBe('1234567890');
    });

    it('accepts country sites but always canonicalizes to eventbrite.com', () => {
        for (const host of ['www.eventbrite.be', 'eventbrite.co.uk', 'www.eventbrite.com.au', 'www.eventbrite.sg']) {
            expect(parseEventbriteEventUrl(`https://${host}/e/some-event-42`)?.canonicalUrl)
                .toBe('https://www.eventbrite.com/e/42');
        }
    });

    it('rejects hosts that only contain "eventbrite"', () => {
        for (const raw of [
            'https://eventbrite.attacker.example/e/x-123',
            'https://myeventbrite.com/e/123',
            'https://www.eventbrite.com.evil.io/e/123',
            'https://eventbrite.example.com/e/123',
        ]) {
            expect(parseEventbriteEventUrl(raw)).toBeNull();
        }
    });

    it('rejects non-event paths and non-URLs', () => {
        expect(parseEventbriteEventUrl('https://www.eventbrite.com/o/cebu-tech-123')).toBeNull();
        expect(parseEventbriteEventUrl('not a url')).toBeNull();
    });
});
