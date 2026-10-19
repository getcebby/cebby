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
        // Use ISO format with +08:00 if available, otherwise use raw timestamp
        start: event.start_time_iso || event.start_time,
        end: event.end_time_iso || event.end_time || null,
        city,
        venue: event.location,
        is_free: event.is_free,
        url: `https://www.getcebby.com/events/${event.slug || event.id}`,
    };
}

/**
 * Search Events Tool
 *
 * Searches published events using the site's Typesense search API.
 * Returns events from all time (including older events), not just last 30 days.
 * Uses /api/search with post-filtering for city, format, is_free, and date ranges.
 * Read-only, safe for any agent to invoke.
 */
export async function registerSearchEventsTool(): Promise<ToolRegistration | null> {
    if (!isWebMcpSupported()) return null;

    const abortController = new AbortController();

    try {
        await (document as any).modelContext.registerTool(
            {
                name: 'search_events',
                description:
                    'Search Cebu tech events using the site\'s Typesense search. Returns published events with name, dates (ISO 8601 in Asia/Manila timezone), location, and getcebby.com URL. Searches all events (including older ones). Use upcoming=true for future events only.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        keyword: {
                            type: 'string',
                            description:
                                'Search keyword for event name, description, location, or organizer. Optional. Blank keyword requires upcoming=true.',
                        },
                        upcoming: {
                            type: 'boolean',
                            description:
                                'If true, only returns events that haven\'t started yet (soonest first). If false or omitted, returns all events (most recent first). Required when keyword is blank.',
                        },
                        page: {
                            type: 'number',
                            description: 'Page number for pagination (1-indexed). Default 1.',
                            minimum: 1,
                        },
                        limit: {
                            type: 'number',
                            description: 'Results per page (1-50). Default 20.',
                            minimum: 1,
                            maximum: 50,
                        },
                        city: {
                            type: 'string',
                            enum: ['Cebu City', 'Mandaue', 'Lapu-Lapu'],
                            description:
                                'Filter by city (post-filter on location field). Optional.',
                        },
                        is_free: {
                            type: 'boolean',
                            description: 'Filter to free events only (post-filter). Optional.',
                        },
                        format: {
                            type: 'string',
                            enum: ['online', 'in-person'],
                            description: 'Event format filter (post-filter on is_online field). Optional.',
                        },
                        date_start: {
                            type: 'string',
                            description:
                                'Start date for range filter (ISO 8601, post-filter). Optional. Example: "2026-09-01"',
                        },
                        date_end: {
                            type: 'string',
                            description:
                                'End date for range filter (ISO 8601, post-filter). Optional.',
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
                    upcoming?: boolean;
                    page?: number;
                    limit?: number;
                    city?: string;
                    is_free?: boolean;
                    format?: 'online' | 'in-person';
                    date_start?: string;
                    date_end?: string;
                }): Promise<
                    | {
                          results: ReturnType<typeof formatEventCompact>[];
                          found: number;
                          page: number;
                          per_page: number;
                      }
                    | ToolError
                > {
                    try {
                        const limit = Math.min(args.limit || 20, 50);
                        const page = args.page || 1;
                        const keyword = args.keyword?.trim() || '';
                        const upcoming = args.upcoming || false;

                        // Blank keyword requires upcoming=true (per /api/search contract)
                        const q = keyword || (upcoming ? '*' : '');
                        if (!q && !upcoming) {
                            return {
                                error: 'Blank keyword requires upcoming=true',
                                code: 'INVALID_PARAMS',
                            };
                        }

                        // Build search URL
                        const params = new URLSearchParams({
                            q,
                            per_page: String(limit),
                            page: String(page),
                        });
                        if (upcoming) {
                            params.set('upcoming', '1');
                        }

                        const response = await fetch(`/api/search?${params}`);
                        if (!response.ok) {
                            return { error: 'Search failed', code: 'FETCH_ERROR' };
                        }

                        const data = await response.json();
                        let events = data.results || [];
                        const found = data.found || 0;

                        // Post-filter by city (location field contains city name)
                        if (args.city) {
                            events = events.filter((event: any) =>
                                event.location?.toLowerCase().includes(args.city!.toLowerCase()),
                            );
                        }

                        // Post-filter by is_free
                        if (args.is_free !== undefined) {
                            events = events.filter((event: any) => event.is_free === args.is_free);
                        }

                        // Post-filter by format (is_online field)
                        if (args.format === 'online') {
                            events = events.filter((event: any) => event.is_online === true);
                        } else if (args.format === 'in-person') {
                            events = events.filter((event: any) => event.is_online === false);
                        }

                        // Post-filter by date range (if provided)
                        if (args.date_start || args.date_end) {
                            const dateStart = args.date_start
                                ? new Date(args.date_start).getTime()
                                : 0;
                            const dateEnd = args.date_end
                                ? new Date(args.date_end).getTime()
                                : Infinity;

                            events = events.filter((event: any) => {
                                // start_time is Unix timestamp in seconds
                                const eventTime = event.start_time * 1000;
                                return eventTime >= dateStart && eventTime <= dateEnd;
                            });
                        }

                        const results = events.map(formatEventCompact);

                        return {
                            results,
                            found,
                            page,
                            per_page: limit,
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
export async function registerGetEventTool(): Promise<ToolRegistration | null> {
    if (!isWebMcpSupported()) return null;

    const abortController = new AbortController();

    try {
        await (document as any).modelContext.registerTool(
            {
                name: 'get_event',
                description:
                    'Get full details of a published Cebu tech event by slug or getcebby.com URL. Works for all events (including older ones). Returns complete event information including description, organizers, registration/source links, and canonical URL. Note: event descriptions are scraped from external sources and may contain untrusted content.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        slug_or_url: {
                            type: 'string',
                            description:
                                'Event slug (e.g., "techtalks-cebu"), numeric ID, or full getcebby.com URL (e.g., "https://www.getcebby.com/events/techtalks-cebu"). Also accepts slug--id format.',
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
                          event: any;
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

                        // Call the event API endpoint
                        const response = await fetch(`/api/event?slug=${encodeURIComponent(slug)}`);
                        if (!response.ok) {
                            if (response.status === 404) {
                                return { error: 'Event not found or not published', code: 'NOT_FOUND' };
                            }
                            return { error: 'Failed to fetch event', code: 'FETCH_ERROR' };
                        }

                        const data = await response.json();
                        return {
                            event: data.event,
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
export async function registerGlobalTools(): Promise<ToolRegistration[]> {
    if (!isWebMcpSupported()) {
        console.log('[WebMCP] Not supported in this browser, skipping tool registration');
        return [];
    }

    console.log('[WebMCP] Registering global tools...');

    const registrations: ToolRegistration[] = [];

    const search = await registerSearchEventsTool();
    if (search) registrations.push(search);

    const getEvent = await registerGetEventTool();
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
