/**
 * WebMCP Tools for Event Detail Pages
 *
 * Page-scoped tools that are only registered on /events/[slug] pages.
 * These tools provide context-aware access to the currently viewed event.
 */

import type { EventFromDB } from '../../types/database';
import type { ToolRegistration, ToolError } from './tools';
import { isWebMcpSupported } from './tools';

/**
 * Get Current Event Tool (event detail page only)
 *
 * Returns the event currently being viewed on the page.
 * Only available on /events/[slug] pages.
 */
export function registerGetCurrentEventTool(event: EventFromDB): ToolRegistration | null {
    if (!isWebMcpSupported()) return null;

    const abortController = new AbortController();

    try {
        (document as any).modelContext.registerTool(
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
                          event: EventFromDB & {
                              canonical_url: string;
                          };
                      }
                    | ToolError
                > {
                    try {
                        return {
                            event: {
                                ...event,
                                canonical_url: `https://www.getcebby.com/events/${event.slug || event.id}`,
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
            { signal: abortController.signal },
        );

        console.log('[WebMCP] Registered: get_current_event (page-scoped)');
        return { name: 'get_current_event', abortController };
    } catch (err) {
        console.error('[WebMCP] Failed to register get_current_event:', err);
        return null;
    }
}

/**
 * Register all event detail page tools.
 * Call this from the event detail page script.
 */
export function registerEventDetailTools(event: EventFromDB): ToolRegistration[] {
    if (!isWebMcpSupported()) {
        return [];
    }

    console.log('[WebMCP] Registering event detail page tools...');

    const registrations: ToolRegistration[] = [];

    const currentEvent = registerGetCurrentEventTool(event);
    if (currentEvent) registrations.push(currentEvent);

    console.log(`[WebMCP] Registered ${registrations.length} event detail page tools`);
    return registrations;
}
