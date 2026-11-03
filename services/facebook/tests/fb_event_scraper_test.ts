import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { findJsonInString, parseEventHtml } from '../supabase/functions/_shared/fb-event-scraper/index.ts';

const EVENT_ID = '2552868275211222';
const START = 1795222800; // 2026-11-21 09:00 UTC+08
const END = 1795251600; // 2026-11-21 17:00 UTC+08

/**
 * Since November 2026 Facebook's page shell carries this module config. Its
 * "data" key sits in the HTML before the event's own "data" object, which is
 * where the end time and timezone live.
 */
const SHELL_WITH_NULL_DATA = '["PolarisPrivacyFlowTrigger",[],{"data":null},7462]';

interface PageOptions {
    shell?: string;
    online?: boolean;
    /** JSON for the event_place value; "null" when the event has no location set. */
    place?: string;
    /** Fragments placed before the event data, e.g. other events' null fields. */
    before?: string;
}

/** A trimmed, synthetic event page in the shape Facebook serves logged-out visitors. */
function eventPage({ shell = SHELL_WITH_NULL_DATA, online = false, place, before = '' }: PageOptions = {}): string {
    const basic = {
        id: EVENT_ID,
        name: 'Malfunction Hackathon IDE.A',
        is_canceled: false,
        is_online: online,
        url: `https://www.facebook.com/events/${EVENT_ID}/`,
        day_time_sentence: 'Saturday, November 21, 2026 at 9:00 AM – 5:00 PM PST',
        start_timestamp: START,
        parent_if_exists_or_self: { id: EVENT_ID },
    };
    const hosts = [{
        __typename: 'User',
        id: '61579580901883',
        name: 'IDE.A Tech Club',
        url: 'https://www.facebook.com/people/IDEA-Tech-Club/61579580901883/',
        profile_picture: { uri: 'https://scontent.example/host.jpg' },
    }];
    const eventPlace = place ?? JSON.stringify({
        __typename: 'FreeformPlace',
        id: '122187667466986030',
        name: 'iACADEMY Cebu',
        place_type: 'TEXT',
        location: { latitude: 10.316092846461, longitude: 123.92606324503 },
    });
    const onlineSetup = online
        ? `,"online_event_setup":{"third_party_url":"https://meet.example/x","type":"THIRD_PARTY"}`
        : '';
    const timeData = JSON.stringify({ tz_display_name: 'UTC+08', start_timestamp: START, end_timestamp: END });

    return [
        '<!DOCTYPE html><html><head>',
        `<script>${shell}</script>`,
        '</head><body>',
        `<script type="application/json">${before}</script>`,
        '<script type="application/json">{',
        `"event_place":${eventPlace}`,
        `,"event_description":{"text":"Not every problem needs a solution."}`,
        `,"event_hosts_that_can_view_guestlist":${JSON.stringify(hosts)}`,
        `,"event_connected_users_public_responded":{"count":7}`,
        `,"discovery_categories":[]`,
        onlineSetup,
        '}</script>',
        `<script type="application/json">{"label":"EventCometLineupsCardMeta_event","data":${timeData}}</script>`,
        `<script type="application/json">{"event":${JSON.stringify(basic)}}</script>`,
        '</body></html>',
    ].join('');
}

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
