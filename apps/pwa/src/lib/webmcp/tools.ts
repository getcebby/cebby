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

// Manila is UTC+8 (no DST)
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/i;

// UTC epoch ms of Manila midnight on that calendar day, or null for impossible
// days like 2026-02-30 (which Date.UTC would silently roll into March)
function manilaMidnight(year: string, month: string, day: string): number | null {
    const utcMidnight = Date.UTC(Number(year), Number(month) - 1, Number(day));
    const check = new Date(utcMidnight);
    if (
        check.getUTCFullYear() !== Number(year) ||
        check.getUTCMonth() !== Number(month) - 1 ||
        check.getUTCDate() !== Number(day)
    ) {
        return null;
    }
    return utcMidnight - MANILA_OFFSET_MS;
}

// Helper: Parse a date filter as epoch ms, or null if it isn't valid ISO 8601
// Date-only inputs like '2026-10-20' are interpreted as Asia/Manila calendar day
// Datetimes without an offset are Manila wall-clock time; with one, taken as-is
function parseManilaDate(dateInput: string, isEndOfDay: boolean): number | null {
    const input = dateInput.trim();

    const date = ISO_DATE.exec(input);
    if (date) {
        const start = manilaMidnight(date[1], date[2], date[3]);
        if (start === null) return null;
        return isEndOfDay ? start + DAY_MS - 1 : start;
    }

    const datetime = ISO_DATETIME.exec(input);
    if (datetime) {
        if (manilaMidnight(datetime[1], datetime[2], datetime[3]) === null) return null;
        const ms = new Date(datetime[4] ? input : `${input}+08:00`).getTime();
        return Number.isNaN(ms) ? null : ms;
    }

    return null;
}

// Structured error response for tool execution failures
export interface ToolError {
    error: string;
    code?: string;
}

// The browser does not enforce inputSchema before calling execute, so every
// tool validates its own arguments before fetching or navigating
export function invalidParams(error: string): ToolError {
    return { error, code: 'INVALID_PARAMS' };
}

export function isIntegerInRange(value: unknown, min: number, max: number): value is number {
    return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

const SEARCH_CITIES = ['Cebu City', 'Mandaue', 'Lapu-Lapu'];
const SEARCH_FORMATS = ['online', 'in-person'];

interface SearchEventsArgs {
    keyword?: string;
    upcoming?: boolean;
    page?: number;
    limit?: number;
    city?: string;
    is_free?: boolean;
    format?: 'online' | 'in-person';
    date_start?: string;
    date_end?: string;
}

// Checks types, integer bounds, enums, date syntax and date order; returns the
// parsed date bounds (epoch seconds) or an INVALID_PARAMS error
function validateSearchArgs(
    args: SearchEventsArgs,
): { startAfter?: number; startBefore?: number } | ToolError {
    if (args.keyword !== undefined && typeof args.keyword !== 'string') {
        return invalidParams('keyword must be a string');
    }
    for (const flag of ['upcoming', 'is_free'] as const) {
        if (args[flag] !== undefined && typeof args[flag] !== 'boolean') {
            return invalidParams(`${flag} must be a boolean`);
        }
    }
    if (args.page !== undefined && !isIntegerInRange(args.page, 1, Number.MAX_SAFE_INTEGER)) {
        return invalidParams('page must be an integer of 1 or more');
    }
    if (args.limit !== undefined && !isIntegerInRange(args.limit, 1, 50)) {
        return invalidParams('limit must be an integer from 1 to 50');
    }
    if (args.city !== undefined && !SEARCH_CITIES.includes(args.city)) {
        return invalidParams(`city must be one of: ${SEARCH_CITIES.join(', ')}`);
    }
    if (args.format !== undefined && !SEARCH_FORMATS.includes(args.format)) {
        return invalidParams(`format must be one of: ${SEARCH_FORMATS.join(', ')}`);
    }

    const bounds: { startAfter?: number; startBefore?: number } = {};
    for (const [field, isEndOfDay] of [['date_start', false], ['date_end', true]] as const) {
        const value = args[field];
        if (value === undefined) continue;
        const ms = typeof value === 'string' ? parseManilaDate(value, isEndOfDay) : null;
        if (ms === null) {
            return invalidParams(`${field} must be an ISO 8601 date (YYYY-MM-DD) or datetime`);
        }
        bounds[isEndOfDay ? 'startBefore' : 'startAfter'] = Math.floor(ms / 1000);
    }
    if (
        bounds.startAfter !== undefined &&
        bounds.startBefore !== undefined &&
        bounds.startAfter > bounds.startBefore
    ) {
        return invalidParams('date_start must be on or before date_end');
    }

    return bounds;
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
export async function registerSearchEventsTool(signal: AbortSignal): Promise<string | null> {
    // Skip once the page lifetime has ended (pagehide fired while loading)
    if (!isWebMcpSupported() || signal.aborted) return null;

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
                            type: 'integer',
                            description: 'Page number for pagination (1-indexed). Default 1.',
                            minimum: 1,
                        },
                        limit: {
                            type: 'integer',
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
                                'Start date for range filter (ISO 8601, search-level filter). Date-only inputs and datetimes without an offset are interpreted as Manila timezone. Optional. Example: "2026-09-01"',
                        },
                        date_end: {
                            type: 'string',
                            description:
                                'End date for range filter (ISO 8601, search-level filter, inclusive). Date-only inputs and datetimes without an offset are interpreted as Manila timezone. Optional.',
                        },
                    },
                    additionalProperties: false,
                },
                annotations: {
                    readOnlyHint: true,
                    untrustedContentHint: true,
                    consequentialHint: false,
                },
                async execute(args: SearchEventsArgs = {}): Promise<
                    | {
                          results: ReturnType<typeof formatEventCompact>[];
                          found: number;
                          page: number;
                          per_page: number;
                      }
                    | ToolError
                > {
                    try {
                        const validated = validateSearchArgs(args);
                        if ('error' in validated) return validated;
                        const { startAfter, startBefore } = validated;

                        const limit = args.limit ?? 20;
                        const page = args.page ?? 1;
                        const keyword = args.keyword?.trim() || '';
                        const upcoming = args.upcoming || false;

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
            { signal },
        );

        console.log('[WebMCP] Registered: search_events');
        return 'search_events';
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
export async function registerGetEventTool(signal: AbortSignal): Promise<string | null> {
    if (!isWebMcpSupported() || signal.aborted) return null;

    try {
        await (document as any).modelContext.registerTool(
            {
                name: 'get_event',
                description:
                    'Get full details of a Cebu tech event listed on getcebby.com by slug or getcebby.com URL. Works for all events (including older ones). Returns complete event information including status (cancelled events stay listed with status "cancelled"), description, organizers, registration/source links, and canonical URL. Note: event descriptions are scraped from external sources and may contain untrusted content.',
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
                                return { error: 'Event not found', code: 'NOT_FOUND' };
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
            { signal },
        );

        console.log('[WebMCP] Registered: get_event');
        return 'get_event';
    } catch (err) {
        console.error('[WebMCP] Failed to register get_event:', err);
        return null;
    }
}

/**
 * Register all global (cross-page) tools.
 * Call this in the main layout or app initialization.
 *
 * `signal` is the page lifetime: aborting it (on pagehide) unregisters every
 * tool registered here. Returns the names of the tools that were registered.
 */
export async function registerGlobalTools(signal: AbortSignal): Promise<string[]> {
    if (!isWebMcpSupported()) {
        console.log('[WebMCP] Not supported in this browser, skipping tool registration');
        return [];
    }

    console.log('[WebMCP] Registering global tools...');

    const registered: string[] = [];

    const search = await registerSearchEventsTool(signal);
    if (search) registered.push(search);

    const getEvent = await registerGetEventTool(signal);
    if (getEvent) registered.push(getEvent);

    console.log(`[WebMCP] Registered ${registered.length} global tools`);
    return registered;
}
