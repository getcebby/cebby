/**
 * WebMCP Tools for Event Detail Pages
 *
 * Page-scoped tools that are only registered on /events/[slug] pages.
 * These tools provide context-aware access to the currently viewed event.
 */

import type { EventFromDB } from '../../types/database';
import type { ToolError } from './tools';
import { isWebMcpSupported } from './tools';

// Cebu events are Asia/Manila (+08:00, no DST)
const MANILA_OFFSET_SECONDS = 8 * 60 * 60;

function toManilaIso(isoString: string | null | undefined): string | null {
    if (!isoString) return null;
    // Parse the ISO timestamp and add Manila offset
    const date = new Date(isoString);
    const epochSeconds = Math.floor(date.getTime() / 1000);
    return new Date((epochSeconds + MANILA_OFFSET_SECONDS) * 1000)
        .toISOString()
        .replace('.000Z', '+08:00');
}

/**
 * Get Current Event Tool (event detail page only)
 *
 * Returns the event currently being viewed on the page.
 * Only available on /events/[slug] pages.
 */
export async function registerGetCurrentEventTool(
    event: EventFromDB,
    signal: AbortSignal,
): Promise<string | null> {
    if (!isWebMcpSupported() || signal.aborted) return null;

    try {
        await (document as any).modelContext.registerTool(
            {
                name: 'get_current_event',
                description:
                    'Get the full details of the event currently displayed on this page. Only available on event detail pages (/events/*). Returns the same information as get_event but for the page you are viewing.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false,
                },
                annotations: {
                    readOnlyHint: true,
                    untrustedContentHint: true,
                    consequentialHint: false,
                },
                async execute(): Promise<
                    | {
                          event: any;
                      }
                    | ToolError
                > {
                    try {
                        // Format organizers same as /api/event
                        const organizers = (event.organizers || [])
                            .filter((o: any) => o?.accounts?.name)
                            .map((o: any) => o.accounts.name);

                        // Format source links same as /api/event
                        const source_links = (event.source_links || []).map((s: any) => ({
                            source: s.source,
                            url: s.url,
                        }));

                        return {
                            event: {
                                ...event,
                                start_time: toManilaIso(event.start_time),
                                end_time: toManilaIso(event.end_time),
                                canonical_url: `https://www.getcebby.com/events/${event.slug || event.id}`,
                                organizers,
                                source_links,
                            },
                        };
                    } catch (err) {
                        console.error('[WebMCP] get_current_event exception:', err);
                        return {
                            error:
                                err instanceof Error
                                    ? err.message
                                    : 'Failed to get current event',
                        };
                    }
                },
            },
            { signal },
        );

        console.log('[WebMCP] Registered: get_current_event (page-scoped)');
        return 'get_current_event';
    } catch (err) {
        console.error('[WebMCP] Failed to register get_current_event:', err);
        return null;
    }
}

/**
 * Register all event detail page tools.
 * Call this from the event detail page script; aborting `signal` unregisters them.
 */
export async function registerEventDetailTools(event: EventFromDB, signal: AbortSignal): Promise<string[]> {
    if (!isWebMcpSupported()) {
        return [];
    }

    console.log('[WebMCP] Registering event detail page tools...');

    const registered: string[] = [];

    const currentEvent = await registerGetCurrentEventTool(event, signal);
    if (currentEvent) registered.push(currentEvent);

    console.log(`[WebMCP] Registered ${registered.length} event detail page tools`);
    return registered;
}
