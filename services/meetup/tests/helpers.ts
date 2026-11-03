// Synthetic Meetup pages shared by the Meetup tests.

/** A page whose __NEXT_DATA__ carries `pageProps`, the way Meetup serves it. */
export function nextDataPage(pageProps: Record<string, unknown>): string {
    return [
        '<!DOCTYPE html><html><head></head><body>',
        `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script>`,
        '</body></html>',
    ].join('');
}

export const GROUP_URLNAME = 'aws-sbg-at-national-university-cebu-campus';
export const EVENT_ID = '317074920';
export const EVENT_URL = `https://www.meetup.com/${GROUP_URLNAME}/events/${EVENT_ID}/`;

/** An event detail page whose Apollo state holds one Event, its Group and its Venue. */
export function eventPage(dateTime: string): string {
    return nextDataPage({
        __APOLLO_STATE__: {
            [`Event:${EVENT_ID}`]: {
                id: EVENT_ID,
                title: 'AWS Student Builder Day',
                eventUrl: EVENT_URL,
                dateTime,
                group: { __ref: 'Group:38001' },
                venue: { __ref: 'Venue:27001' },
            },
            'Group:38001': { id: '38001', name: 'AWS SBG NU Cebu', urlname: GROUP_URLNAME, city: 'Cebu City' },
            'Venue:27001': { name: 'National University Cebu', address: 'Mandaue City', city: 'Cebu City' },
        },
    });
}
