/**
 * Public Facebook event scraper, vendored from facebook-event-scraper
 * (https://github.com/francescov1/facebook-event-scraper, MIT, see LICENSE)
 * at commit b97b90b (v0.2.7, 2026-05-12).
 *
 * Changes from upstream:
 *   - fetch instead of axios; no proxy/cookie options (nothing here used them).
 *   - Parsing is split from fetching (`parseEventHtml`) so it can be tested
 *     against fixture HTML.
 *   - A group's event list that isn't a list fails like a missing one, instead
 *     of reading as a group with no events (`getEventListFromGroup`).
 *
 * Facebook changes its markup without notice, so this parser is ours to
 * maintain. Tests live in services/facebook/tests/fb_event_scraper_test.ts.
 */
import * as eventListParser from './event-list-parser.ts';
import * as htmlParser from './html-parser.ts';
import { fetchEvent } from './network.ts';
import {
    type EventData,
    type EventLocation,
    EventType,
    type OnlineEventDetails,
    type ShortEventData,
} from './types.ts';
import {
    fbidToUrl,
    validateAndFormatEventGroupUrl,
    validateAndFormatEventPageUrl,
    validateAndFormatEventProfileUrl,
    validateAndFormatUrl,
} from './url.ts';

export { findJsonInString } from './json.ts';
export { EventType };
export type { EventData, ShortEventData };
export type { EventCategory, EventHost, EventLocation, EventPhoto, OnlineEventDetails } from './types.ts';

/** Parse a public event page into EventData. */
export const parseEventHtml = (html: string): EventData => {
    // NOTE: If we want to pick up multi-date events (technically this is just multiple events linked together), we can look at the comet_neighboring_siblings key
    const {
        id,
        name,
        photo,
        photos,
        video,
        isOnline,
        isCanceled,
        url,
        startTimestamp,
        formattedDate,
        siblingEvents,
        parentEvent,
    } = htmlParser.getBasicData(html);

    const { endTimestamp, timezone } = htmlParser.getEndTimestampAndTimezone(html, startTimestamp);

    let location: EventLocation | null = null;
    let onlineDetails: OnlineEventDetails | null = null;
    if (isOnline) {
        onlineDetails = htmlParser.getOnlineDetails(html);
    } else {
        location = htmlParser.getLocation(html);
    }

    const description = htmlParser.getDescription(html);
    const ticketUrl = htmlParser.getTicketUrl(html);
    const categories = htmlParser.getCategories(html);
    const hosts = htmlParser.getHosts(html);
    const { usersResponded } = htmlParser.getUserStats(html);

    return {
        id,
        name,
        description,
        location,
        photo,
        photos,
        video,
        isOnline,
        isCanceled,
        url,
        startTimestamp,
        endTimestamp,
        formattedDate,
        timezone,
        onlineDetails,
        hosts,
        ticketUrl,
        categories,
        siblingEvents,
        parentEvent,
        usersResponded,
    };
};

export const scrapeFbEvent = async (url: string): Promise<EventData> => {
    return parseEventHtml(await fetchEvent(validateAndFormatUrl(url)));
};

export const scrapeFbEventFromFbid = async (fbid: string): Promise<EventData> => {
    return parseEventHtml(await fetchEvent(fbidToUrl(fbid)));
};

export const scrapeFbEventListFromPage = async (url: string, type?: EventType): Promise<ShortEventData[]> => {
    const html = await fetchEvent(validateAndFormatEventPageUrl(url, type));
    return eventListParser.getEventListFromPageOrProfile(html);
};

export const scrapeFbEventListFromProfile = async (url: string, type?: EventType): Promise<ShortEventData[]> => {
    const html = await fetchEvent(validateAndFormatEventProfileUrl(url, type));
    return eventListParser.getEventListFromPageOrProfile(html);
};

export const scrapeFbEventListFromGroup = async (url: string, type?: EventType): Promise<ShortEventData[]> => {
    const html = await fetchEvent(validateAndFormatEventGroupUrl(url));
    return eventListParser.getEventListFromGroup(html, type);
};

export const scrapeFbEventList = (url: string, type?: EventType): Promise<ShortEventData[]> => {
    if (url.includes('/groups/')) {
        return scrapeFbEventListFromGroup(url, type);
    }
    if (url.includes('/profile.php')) {
        return scrapeFbEventListFromProfile(url, type);
    }
    return scrapeFbEventListFromPage(url, type);
};
