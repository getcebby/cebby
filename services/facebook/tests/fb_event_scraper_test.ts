import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { findJsonInString, parseEventHtml } from '../supabase/functions/_shared/fb-event-scraper/index.ts';
import {
    validateAndFormatEventGroupUrl,
    validateAndFormatEventPageUrl,
    validateAndFormatEventProfileUrl,
} from '../supabase/functions/_shared/fb-event-scraper/url.ts';
import { EventType } from '../supabase/functions/_shared/fb-event-scraper/types.ts';
import { END, EVENT_ID, eventPage, START } from './helpers.ts';

describe('event list URL validation', () => {
    it('accepts the URL shapes the watch-list cron and smoke scripts use', () => {
        expect(
            validateAndFormatEventPageUrl(
                'https://www.facebook.com/gdgcebuorg/upcoming_hosted_events',
                EventType.Upcoming,
            ),
        )
            .toBe('https://www.facebook.com/gdgcebuorg/upcoming_hosted_events?_fb_noscript=1');
        expect(
            validateAndFormatEventProfileUrl(
                'https://www.facebook.com/profile.php?id=61574188777317&sk=upcoming_hosted_events',
            ),
        )
            .toBe('https://www.facebook.com/profile.php?id=61574188777317&sk=upcoming_hosted_events');
        expect(validateAndFormatEventGroupUrl('https://www.facebook.com/groups/409785992417637'))
            .toBe('https://www.facebook.com/groups/409785992417637/events?_fb_noscript=1');
    });

    it('rejects a Facebook-looking path on another host', () => {
        expect(() => validateAndFormatEventPageUrl('https://evil.example/facebook.com/somepage')).toThrow();
        expect(() => validateAndFormatEventProfileUrl('https://evil.example/facebook.com/profile.php?id=1')).toThrow();
        expect(() => validateAndFormatEventGroupUrl('https://evil.example/?u=facebook.com/groups/abc')).toThrow();
    });

    it('rejects a facebook.com look-alike host and credentials in the URL', () => {
        expect(() => validateAndFormatEventGroupUrl('https://facebook.com.evil.example/x/facebook.com/groups/abc'))
            .toThrow();
        expect(() => validateAndFormatEventPageUrl('https://user:pw@www.facebook.com/somepage')).toThrow();
    });
});

describe('findJsonInString', () => {
    const hasA = (candidate: Record<string, unknown>) => 'a' in candidate;

    it('skips a null value and keeps looking for the object that matches', () => {
        const { jsonData } = findJsonInString('[{"data":null},{"data":{"a":1}}]', 'data', hasA);
        expect(jsonData).toEqual({ a: 1 });
    });

    it('skips string and number values and keeps looking for the object that matches', () => {
        const { jsonData } = findJsonInString('[{"data":"x"},{"data":3},{"data":{"a":1}}]', 'data', hasA);
        expect(jsonData).toEqual({ a: 1 });
    });

    it('reports a null value as present but empty when no object matches', () => {
        const { jsonData, startIndex } = findJsonInString('{"event_place":null}', 'event_place', hasA);
        expect(jsonData).toBeNull();
        expect(startIndex).toBeGreaterThan(-1);
    });

    it('reports a missing key with startIndex -1', () => {
        const { jsonData, startIndex } = findJsonInString('{"other":{"a":1}}', 'data', hasA);
        expect(jsonData).toBeNull();
        expect(startIndex).toBe(-1);
    });

    it('returns the first value, null included, when no predicate is given', () => {
        const { jsonData } = findJsonInString('[{"data":null},{"data":{"a":1}}]', 'data');
        expect(jsonData).toBeNull();
    });
});

describe('parseEventHtml', () => {
    it('reads the end time and timezone even when the page shell has an earlier "data":null', () => {
        const event = parseEventHtml(eventPage());

        expect(event.id).toBe(EVENT_ID);
        expect(event.name).toBe('Malfunction Hackathon IDE.A');
        expect(event.startTimestamp).toBe(START);
        expect(event.endTimestamp).toBe(END);
        expect(event.timezone).toBe('UTC+08');
        expect(event.isOnline).toBe(false);
        expect(event.location?.name).toBe('iACADEMY Cebu');
        expect(event.description).toBe('Not every problem needs a solution.');
        expect(event.hosts).toEqual([{
            id: '61579580901883',
            name: 'IDE.A Tech Club',
            url: 'https://www.facebook.com/people/IDEA-Tech-Club/61579580901883/',
            type: 'User',
            photo: { imageUri: 'https://scontent.example/host.jpg' },
        }]);
        expect(event.usersResponded).toBe(7);
    });

    it('reads online details even when other events on the page have "online_event_setup":null', () => {
        const html = eventPage({ shell: '', online: true, before: '[{"online_event_setup":null}]' });
        const event = parseEventHtml(html);

        expect(event.isOnline).toBe(true);
        expect(event.location).toBeNull();
        expect(event.onlineDetails).toEqual({ url: 'https://meet.example/x', type: 'THIRD_PARTY' });
    });

    it('returns no location when the event has none set', () => {
        const event = parseEventHtml(eventPage({ shell: '', place: 'null' }));
        expect(event.location).toBeNull();
    });

    it('still fails loudly when the page has no end time data at all', () => {
        const html = eventPage().replace(/"data":\{"tz_display_name"[^}]*\}/, '"data":{}');
        expect(() => parseEventHtml(html)).toThrow('No end date & timezone details found');
    });
});
