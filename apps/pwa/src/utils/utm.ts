// UTM tagging for outbound deep-links to source platforms (Luma, Facebook,
// Eventbrite, etc). Lets us see which Cebby surfaces drive the most traffic
// to event sources without owning the registration ourselves.

export type EventState = 'live' | 'ended' | 'upcoming';

export interface UtmOptions {
    /** What kind of trigger fired the link (e.g. "rsvp_button", "ended_view"). */
    medium: string;
    /** State of the event when the user clicked. */
    eventState: EventState;
    /** Override campaign — defaults to "event_listing". */
    campaign?: string;
}

export function addUtmParameters(url: string, options: UtmOptions): string {
    if (!url) return url;

    const params = new URLSearchParams({
        utm_source: 'cebby_app',
        utm_medium: options.medium,
        utm_campaign: options.campaign ?? 'event_listing',
        utm_content: options.eventState,
    });

    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${params.toString()}`;
}
