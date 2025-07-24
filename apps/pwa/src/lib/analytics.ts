// Analytics utility functions for Umami tracking

declare global {
    interface Window {
        umami?: {
            track: (event: string, data?: Record<string, any>) => void;
        };
    }
}

/**
 * Track a custom event with Umami
 * @param event - The event name (e.g., 'search', 'event_save', 'event_click')
 * @param data - Additional event data/properties
 */
export function trackEvent(event: string, data?: Record<string, any>) {
    try {
        if (typeof window !== 'undefined' && window.umami) {
            window.umami.track(event, data);
        }
    } catch (error) {
        console.warn('Analytics tracking failed:', error);
    }
}

/**
 * Track search events with query and result count
 */
export function trackSearch(query: string, resultCount: number, source: 'header' | 'page' | 'mobile' = 'header') {
    trackEvent('search', {
        query: query.toLowerCase().trim(),
        result_count: resultCount,
        source,
        query_length: query.length,
        has_results: resultCount > 0
    });
}

/**
 * Track event interactions
 */
export function trackEventAction(action: 'view' | 'save' | 'unsave' | 'share' | 'calendar_add', eventData: {
    event_id: string;
    event_name?: string;
    event_type?: string;
    organization?: string;
    is_free?: boolean;
    is_online?: boolean;
    location?: string;
}) {
    trackEvent(`event_${action}`, {
        event_id: eventData.event_id,
        event_name: eventData.event_name,
        event_type: eventData.event_type,
        organization: eventData.organization,
        is_free: eventData.is_free,
        is_online: eventData.is_online,
        location: eventData.location
    });
}

/**
 * Track navigation events
 */
export function trackNavigation(page: string, source: 'nav' | 'link' | 'search' | 'back' = 'nav') {
    trackEvent('navigate', {
        page,
        source
    });
}

/**
 * Track PWA events
 */
export function trackPWA(action: 'install_prompt_shown' | 'install_accepted' | 'install_dismissed' | 'update_available' | 'update_accepted') {
    trackEvent('pwa', {
        action
    });
}

/**
 * Track user engagement
 */
export function trackEngagement(action: 'page_visible' | 'page_hidden' | 'scroll_depth', data?: Record<string, any>) {
    trackEvent('engagement', {
        action,
        ...data
    });
}