// deno-lint-ignore-file no-explicit-any
import { findJsonInString } from './json.ts';
import { EventType, type ShortEventData } from './types.ts';

export const getEventListFromPageOrProfile = (html: string): ShortEventData[] => {
    const { jsonData } = findJsonInString(html, 'collection');

    if (!jsonData) {
        throw new Error(
            'No event data found, please verify that your URL is correct and the events are accessible without authentication',
        );
    }

    const events: ShortEventData[] = [];

    jsonData.pageItems.edges.forEach((event: any) => {
        events.push({
            id: event.node.node.id,
            name: event.node.node.name,
            url: event.node.node.url,
            date: event.node.node.day_time_sentence,
            isCanceled: event.node.node.is_canceled,
            isPast: event.node.actions_renderer.event.is_past,
        });
    });

    return events;
};

export const getEventListFromGroup = (html: string, type: EventType = EventType.Upcoming): ShortEventData[] => {
    const { jsonData } = findJsonInString(html, type === EventType.Upcoming ? 'upcoming_events' : 'past_events');

    if (!jsonData) {
        throw new Error(
            'No event data found, please verify that your URL is correct and the events are accessible without authentication',
        );
    }

    const events: ShortEventData[] = [];

    if (jsonData.edges.length > 0) {
        jsonData.edges.forEach((event: any) => {
            events.push({
                id: event.node.id,
                name: event.node.name,
                url: event.node.url,
                date: event.node.day_time_sentence,
                isCanceled: event.node.is_canceled,
                isPast: event.node.is_past,
            });
        });
    }

    return events;
};
