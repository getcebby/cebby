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

// Helper: Parse date input as Manila timezone boundary
// Date-only inputs like '2026-10-20' are interpreted as Asia/Manila calendar day
// Full ISO datetimes with offset are accepted as-is
function parseManilaDate(dateInput: string, isEndOfDay: boolean): number {
    // Check if it's a full ISO datetime with offset/timezone
    const hasTimeComponent = /T\d{2}:\d{2}/.test(dateInput);
    
    if (hasTimeComponent) {
        // Full datetime - accept as-is
        return new Date(dateInput).getTime();
    }
    
    // Date-only input - interpret as Manila timezone boundary
    // Manila is UTC+8 (no DST)
    const [year, month, day] = dateInput.split('-').map(Number);
    
    if (isEndOfDay) {
        // End of day: 23:59:59.999 Manila = 15:59:59.999 UTC
        return Date.UTC(year, month - 1, day, 15, 59, 59, 999);
    } else {
        // Start of day: 00:00:00 Manila = 16:00:00 UTC previous day
        return Date.UTC(year, month - 1, day - 1, 16, 0, 0, 0);
    }
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
                    'Search Cebu tech events using the site\'s Typesense search. Returns published events with name, dates (ISO 8601 in Asia/Manila timezone), location, and getcebby.com URL. Searches all events (including older ones). Date/format/is_free filters are applied at the search engine level for accurate pagination and counts. Use upcoming=true for future events only, or provide date bounds for custom ranges.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        keyword: {
                            type: 'string',
                            description:
                                'Search keyword for event name, description, location, or organizer. Optional. Blank keyword allowed when upcoming=true or any date filter is provided.',
                        },
                        upcoming: {
                            type: 'boolean',
                            description:
                                'If true, only returns events that haven\'t started yet (soonest first). If false or omitted, returns all events (most recent first). Optional when date filters are provided.',
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
                                'Filter by city (post-filter on location field, may affect result count). Optional.',
                        },
                        is_free: {
                            type: 'boolean',
                            description: 'Filter to free events only (search-level filter). Optional.',
                        },
                        format: {
                            type: 'string',
                            enum: ['online', 'in-person'],
                            description: 'Event format filter (search-level filter on is_online field). Optional.',
                        },
                        date_start: {
                            type: 'string',
                            description:
                                'Start date for range filter (ISO 8601, search-level filter). Date-only inputs interpreted as Manila timezone. Optional. Example: "2026-09-01"',
                        },
                        date_end: {
                            type: 'string',
                            description:
                                'End date for range filter (ISO 8601, search-level filter). Date-only inputs interpreted as Manila timezone. Optional.',
                        },
                    },
                    additionalProperties: false,
                },
                annotations: {
                    readOnlyHint: true,
                    untrustedContentHint: true,
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

                        // Parse date bounds as Manila timezone epoch seconds
                        let startAfter: number | undefined;
                        let startBefore: number | undefined;
                        
                        if (args.date_start) {
                            startAfter = Math.floor(parseManilaDate(args.date_start, false) / 1000);
                        }
                        if (args.date_end) {
                            startBefore = Math.floor(parseManilaDate(args.date_end, true) / 1000);
                        }

                        // Blank keyword is allowed when upcoming=true or any date bound is given
                        const hasDateFilter = startAfter !== undefined || startBefore !== undefined;
                        const q = keyword || (upcoming || hasDateFilter ? '*' : '');
                        if (!q) {
                            return {
                                error: 'Blank keyword requires upcoming=true or a date filter',
                                code: 'INVALID_PARAMS',
                            };
                        }

                        // Build search URL with Typesense-pushed filters
                        const params = new URLSearchParams({
                            q,
                            per_page: String(limit),
                            page: String(page),
                        });
                        if (upcoming) {
                            params.set('upcoming', '1');
                        }
                        if (startAfter !== undefined) {
                            params.set('start_after', String(startAfter));
                        }
                        if (startBefore !== undefined) {
                            params.set('start_before', String(startBefore));
                        }
                        if (args.is_free !== undefined) {
                            params.set('is_free', args.is_free ? '1' : '0');
                        }
                        if (args.format) {
                            params.set('format', args.format);
                        }

                        const response = await fetch(`/api/search?${params}`);
                        if (!response.ok) {
                            return { error: 'Search failed', code: 'FETCH_ERROR' };
                        }

                        const data = await response.json();
                        
                        // Check if Typesense returned an error
                        if (data.error) {
                            return { error: data.error, code: 'SEARCH_ERROR' };
                        }
                        
                        let events = data.results || [];
                        const found = data.found || 0;

                        // Post-filter by city only (location is a full string, not indexed separately)
                        if (args.city) {
                            events = events.filter((event: any) =>
                                event.location?.toLowerCase().includes(args.city!.toLowerCase()),
                            );
                        }

                        const results = events.map(formatEventCompact);

                        return {
                            results,
                            found: args.city ? results.length : found, // Accurate count (post-filter adjusts for city)
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
