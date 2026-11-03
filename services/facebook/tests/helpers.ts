// Synthetic Facebook event pages shared by the scraper and link-probe tests.

export const EVENT_ID = '2552868275211222';
export const START = 1795222800; // 2026-11-21 09:00 UTC+08
export const END = 1795251600; // 2026-11-21 17:00 UTC+08

/**
 * Since November 2026 Facebook's page shell carries this module config. Its
 * "data" key sits in the HTML before the event's own "data" object, which is
 * where the end time and timezone live.
 */
export const SHELL_WITH_NULL_DATA = '["PolarisPrivacyFlowTrigger",[],{"data":null},7462]';

export interface PageOptions {
    shell?: string;
    online?: boolean;
    /** JSON for the event_place value; "null" when the event has no location set. */
    place?: string;
    /** Fragments placed before the event data, e.g. other events' null fields. */
    before?: string;
}

/** A trimmed, synthetic event page in the shape Facebook serves logged-out visitors. */
export function eventPage({
    shell = SHELL_WITH_NULL_DATA,
    online = false,
    place,
    before = '',
}: PageOptions = {}): string {
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
    const hosts = [
        {
            __typename: 'User',
            id: '61579580901883',
            name: 'IDE.A Tech Club',
            url: 'https://www.facebook.com/people/IDEA-Tech-Club/61579580901883/',
            profile_picture: { uri: 'https://scontent.example/host.jpg' },
        },
    ];
    const eventPlace =
        place ??
        JSON.stringify({
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
