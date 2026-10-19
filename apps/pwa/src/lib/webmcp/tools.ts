/**
 * WebMCP Tool Registry for Cebby
 *
 * Implements the W3C WebML CG draft browser API for registering tools
 * that in-browser AI agents can invoke. All tools are read-only.
 *
 * Spec: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/webmcp/agentic-javascript-tools.md
 * Chrome docs: https://developer.chrome.com/docs/ai/webmcp/imperative-api
 */

// Feature detection type guard
export function isWebMcpSupported(): boolean {
    return 'modelContext' in document;
}

// Tool registration return type (includes abort controller)
export interface ToolRegistration {
    name: string;
    abortController: AbortController;
}

// Structured error response for tool execution failures
export interface ToolError {
    error: string;
    code?: string;
}

// Helper to format events for compact display
function formatEventCompact(event: EventFromDB): {
    name: string;
    start: string;
    end: string | null;
    city: string | null;
    venue: string | null;
    is_free: boolean;
    url: string;
} {
    // Extract city from location
    let city: string | null = null;
    if (event.location) {
        const loc = event.location.toLowerCase();
        if (loc.includes('mandaue')) {
            city = 'Mandaue';
        } else if (loc.includes('lapu-lapu') || loc.includes('mactan')) {
            city = 'Lapu-Lapu';
        } else if (loc.includes('cebu')) {
            city = 'Cebu City';
        }
    }

    return {
        name: event.name,
        start: event.start_time,
        end: event.end_time,
        city,
        venue: event.location,
        is_free: event.is_free,
        url: `https://www.getcebby.com/events/${event.slug || event.id}`,
    };
}

/**
 * Search Events Tool
 *
 * Searches published events with optional filters. Returns compact event list.
 * Read-only, safe for any agent to invoke.
 */
export function registerSearchEventsTool(): ToolRegistration | null {
    if (!isWebMcpSupported()) return null;

    const abortController = new AbortController();

    try {
        (document as any).modelContext.registerTool(
            {
                name: 'search_events',
                description:
                    'Search Cebu tech events with filters. Returns published events only with name, date, location, and getcebby.com URL. Dates in ISO 8601 format (Asia/Manila timezone). Use for finding events by keyword, date range, city, price, or format.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        keyword: {
                            type: 'string',
                            description:
                                'Search keyword for event name, description, or organizer. Optional.',
                        },
                        date_start: {
                            type: 'string',
                            description:
                                'Start date for range filter (ISO 8601 format). If omitted, defaults to today. Example: "2026-10-20"',
                        },
                        date_end: {
                            type: 'string',
                            description:
                                'End date for range filter (ISO 8601 format). Optional.',
                        },
                        city: {
                            type: 'string',
                            enum: ['Cebu City', 'Mandaue', 'Lapu-Lapu'],
                            description: 'Filter by city in Metro Cebu. Optional.',
                        },
                        is_free: {
                            type: 'boolean',
                            description: 'Filter to free events only. Optional.',
                        },
                        format: {
                            type: 'string',
                            enum: ['online', 'in-person'],
                            description: 'Event format filter. Optional.',
                        },
                        limit: {
                            type: 'number',
                            description: 'Maximum results to return (1-50). Default 20.',
                            minimum: 1,
                            maximum: 50,
                        },
                    },
                    additionalProperties: false,
                },
                annotations: {
                    readOnlyHint: true,
                    untrustedContentHint: false,
                    consequentialHint: false,
                },
                async execute(args: {
                    keyword?: string;
                    date_start?: string;
                    date_end?: string;
                    city?: string;
                    is_free?: boolean;
                    format?: 'online' | 'in-person';
                    limit?: number;
                }): Promise<
                    | {
                          results: ReturnType<typeof formatEventCompact>[];
                          count: number;
                      }
                    | ToolError
                > {
                    try {
                        const limit = Math.min(args.limit || 20, 50);

                        // Use existing /api/events-data endpoint (cached)
                        const response = await fetch('/api/events-data');
                        if (!response.ok) {
                            return { error: 'Failed to fetch events', code: 'FETCH_ERROR' };
                        }

                        const data = await response.json();
                        let events = data.allEvents || [];

                        // Filter by date range
                        const dateStart = args.date_start
                            ? new Date(args.date_start).getTime()
                            : Date.now();
                        const dateEnd = args.date_end
                            ? new Date(args.date_end).getTime()
                            : null;

                        events = events.filter((event: any) => {
                            if (event.status !== 'published') return false;
                            const eventTime = new Date(event.start_time).getTime();
                            if (eventTime < dateStart) return false;
                            if (dateEnd && eventTime > dateEnd) return false;
                            return true;
                        });

                        // Filter by keyword
                        if (args.keyword) {
                            const keyword = args.keyword.toLowerCase();
                            events = events.filter((event: any) => {
                                return (
                                    event.name?.toLowerCase().includes(keyword) ||
                                    event.description?.toLowerCase().includes(keyword)
                                );
                            });
                        }

                        // Filter by city
                        if (args.city) {
                            events = events.filter((event: any) => {
                                return event.location?.toLowerCase().includes(args.city!.toLowerCase());
                            });
                        }

                        // Filter by is_free
                        if (args.is_free !== undefined) {
                            events = events.filter((event: any) => event.is_free === args.is_free);
                        }

                        // Filter by format
                        if (args.format === 'online') {
                            events = events.filter((event: any) => event.is_online === true);
                        } else if (args.format === 'in-person') {
                            events = events.filter((event: any) => event.is_online === false);
                        }

                        // Sort by start time and limit
                        events.sort((a: any, b: any) => {
                            return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
                        });
                        events = events.slice(0, limit);

                        const results = events.map(formatEventCompact);

                        return {
                            results,
                            count: results.length,
                        };
                    } catch (err) {
                        console.error('[WebMCP] search_events exception:', err);
                        return {
                            error: err instanceof Error ? err.message : 'Search failed',
                        };
                    }
                },
            },
            { signal: abortController.signal },
        );

        console.log('[WebMCP] Registered: search_events');
        return { name: 'search_events', abortController };
    } catch (err) {
        console.error('[WebMCP] Failed to register search_events:', err);
        return null;
    }
}

/**
 * Get Event Tool
 *
 * Fetches full event details by slug or getcebby.com URL.
 * Descriptions are marked as untrusted (scraped from external sources).
 */
export function registerGetEventTool(): ToolRegistration | null {
    if (!isWebMcpSupported()) return null;

    const abortController = new AbortController();

    try {
        (document as any).modelContext.registerTool(
            {
                name: 'get_event',
                description:
                    'Get full details of a Cebu tech event by slug or getcebby.com URL. Returns complete event information including description, organizer, registration/source links, and canonical URL. Note: event descriptions are scraped from external sources and may contain untrusted content.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        slug_or_url: {
                            type: 'string',
                            description:
                                'Event slug (e.g., "techtalks-cebu") or full getcebby.com URL (e.g., "https://www.getcebby.com/events/techtalks-cebu")',
                        },
                    },
                    required: ['slug_or_url'],
                    additionalProperties: false,
                },
                annotations: {
                    readOnlyHint: true,
                    untrustedContentHint: true,
                    consequentialHint: false,
                },
                async execute(args: {
                    slug_or_url: string;
                }): Promise<
                    | {
                          event: EventFromDB & {
                              canonical_url: string;
                              organizers?: string[];
                              source_links?: { source: string; url: string | null }[];
                          };
                      }
                    | ToolError
                > {
                    try {
                        // Extract slug from URL if needed
                        let slug = args.slug_or_url.trim();
                        const urlMatch = slug.match(/getcebby\.com\/events\/([^/?#]+)/);
                        if (urlMatch) {
                            slug = urlMatch[1];
                        }

                        // Use existing /api/events-data endpoint (cached)
                        const response = await fetch('/api/events-data');
                        if (!response.ok) {
                            return { error: 'Failed to fetch events', code: 'FETCH_ERROR' };
                        }

                        const data = await response.json();
                        const events = data.allEvents || [];

                        // Try to find by slug
                        let event = events.find((e: any) => e.slug === slug);

                        // Fallback: try numeric ID if slug failed
                        if (!event && /^\d+$/.test(slug)) {
                            event = events.find((e: any) => e.id === parseInt(slug, 10));
                        }

                        // Fallback: try extracting ID from slug pattern (name--123)
                        if (!event) {
                            const eventId = slug.split('--')[1];
                            if (eventId && /^\d+$/.test(eventId)) {
                                event = events.find((e: any) => e.id === parseInt(eventId, 10));
                            }
                        }

                        if (!event) {
                            return { error: 'Event not found', code: 'NOT_FOUND' };
                        }

                        // Format organizers
                        const organizers = (event.organizers || [])
                            .filter((o: any) => o?.accounts?.name)
                            .map((o: any) => o.accounts.name);

                        // Format source links
                        const source_links = (event.source_links || []).map((s: any) => ({
                            source: s.source,
                            url: s.url,
                        }));

                        return {
                            event: {
                                ...event,
                                canonical_url: `https://www.getcebby.com/events/${event.slug || event.id}`,
                                organizers,
                                source_links,
                            },
                        };
                    } catch (err) {
                        console.error('[WebMCP] get_event exception:', err);
                        return {
                            error: err instanceof Error ? err.message : 'Failed to fetch event',
                        };
                    }
                },
            },
            { signal: abortController.signal },
        );

        console.log('[WebMCP] Registered: get_event');
        return { name: 'get_event', abortController };
    } catch (err) {
        console.error('[WebMCP] Failed to register get_event:', err);
        return null;
    }
}

/**
 * Register all global (cross-page) tools.
 * Call this in the main layout or app initialization.
 *
 * Returns array of registrations for later cleanup if needed.
 */
export function registerGlobalTools(): ToolRegistration[] {
    if (!isWebMcpSupported()) {
        console.log('[WebMCP] Not supported in this browser, skipping tool registration');
        return [];
    }

    console.log('[WebMCP] Registering global tools...');

    const registrations: ToolRegistration[] = [];

    const search = registerSearchEventsTool();
    if (search) registrations.push(search);

    const getEvent = registerGetEventTool();
    if (getEvent) registrations.push(getEvent);

    console.log(`[WebMCP] Registered ${registrations.length} global tools`);
    return registrations;
}

/**
 * Cleanup helper: unregister tools when no longer needed
 */
export function unregisterTools(registrations: ToolRegistration[]): void {
    for (const reg of registrations) {
        try {
            reg.abortController.abort();
            console.log(`[WebMCP] Unregistered: ${reg.name}`);
        } catch (err) {
            console.warn(`[WebMCP] Failed to unregister ${reg.name}:`, err);
        }
    }
}
