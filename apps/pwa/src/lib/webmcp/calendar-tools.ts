/**
 * WebMCP Tools for Calendar Page
 *
 * Page-scoped tools for /calendar that allow agents to interact with
 * the calendar view and filtering UI state (read-only, no mutations).
 */

import type { ToolRegistration, ToolError } from './tools';
import { isWebMcpSupported } from './tools';

/**
 * Update Calendar Filter Tool
 *
 * Updates the visible calendar filters/UI state. This is marked as read-only
 * because it only changes client-side UI state, not persisted data.
 * Only available on /calendar page.
 */
export function registerUpdateCalendarFilterTool(): ToolRegistration | null {
    if (!isWebMcpSupported()) return null;

    const abortController = new AbortController();

    try {
        (document as any).modelContext.registerTool(
            {
                name: 'update_calendar_filter',
                description:
                    'Update the calendar view to show a specific month. Only available on /calendar page. Changes the visible month and updates the URL. Read-only (only affects UI state, no data mutations).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        year: {
                            type: 'number',
                            description: 'Year to display (e.g., 2026)',
                            minimum: 2020,
                            maximum: 2030,
                        },
                        month: {
                            type: 'number',
                            description: 'Month to display (1-12, where 1 = January)',
                            minimum: 1,
                            maximum: 12,
                        },
                    },
                    required: ['year', 'month'],
                    additionalProperties: false,
                },
                annotations: {
                    readOnlyHint: true,
                    untrustedContentHint: false,
                    consequentialHint: false,
                },
                async execute(args: {
                    year: number;
                    month: number;
                }): Promise<{ success: boolean; url: string } | ToolError> {
                    try {
                        // Format as YYYY-MM-DD for the calendar date param
                        const dateStr = `${args.year}-${String(args.month).padStart(2, '0')}-01`;
                        const targetUrl = `/calendar?date=${dateStr}`;

                        // Navigate to the new month
                        window.location.href = targetUrl;

                        return {
                            success: true,
                            url: `https://www.getcebby.com${targetUrl}`,
                        };
                    } catch (err) {
                        console.error('[WebMCP] update_calendar_filter exception:', err);
                        return {
                            error:
                                err instanceof Error
                                    ? err.message
                                    : 'Failed to update calendar filter',
                        };
                    }
                },
            },
            { signal: abortController.signal },
        );

        console.log('[WebMCP] Registered: update_calendar_filter (page-scoped)');
        return { name: 'update_calendar_filter', abortController };
    } catch (err) {
        console.error('[WebMCP] Failed to register update_calendar_filter:', err);
        return null;
    }
}

/**
 * Get Current Calendar Month Tool
 *
 * Returns the currently displayed month on the calendar page.
 */
export function registerGetCurrentMonthTool(currentDate: Date): ToolRegistration | null {
    if (!isWebMcpSupported()) return null;

    const abortController = new AbortController();

    try {
        (document as any).modelContext.registerTool(
            {
                name: 'get_current_calendar_month',
                description:
                    'Get the month currently displayed on the calendar page. Only available on /calendar page. Returns the year and month being viewed.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false,
                },
                annotations: {
                    readOnlyHint: true,
                    untrustedContentHint: false,
                    consequentialHint: false,
                },
                async execute(): Promise<
                    | {
                          year: number;
                          month: number;
                          monthName: string;
                      }
                    | ToolError
                > {
                    try {
                        const year = currentDate.getFullYear();
                        const month = currentDate.getMonth() + 1;
                        const monthName = currentDate.toLocaleString('default', {
                            month: 'long',
                            year: 'numeric',
                        });

                        return {
                            year,
                            month,
                            monthName,
                        };
                    } catch (err) {
                        console.error('[WebMCP] get_current_calendar_month exception:', err);
                        return {
                            error:
                                err instanceof Error
                                    ? err.message
                                    : 'Failed to get current month',
                        };
                    }
                },
            },
            { signal: abortController.signal },
        );

        console.log('[WebMCP] Registered: get_current_calendar_month (page-scoped)');
        return { name: 'get_current_calendar_month', abortController };
    } catch (err) {
        console.error('[WebMCP] Failed to register get_current_calendar_month:', err);
        return null;
    }
}

/**
 * Register all calendar page tools.
 * Call this from the calendar page script.
 */
export function registerCalendarTools(currentDate: Date): ToolRegistration[] {
    if (!isWebMcpSupported()) {
        return [];
    }

    console.log('[WebMCP] Registering calendar page tools...');

    const registrations: ToolRegistration[] = [];

    const updateFilter = registerUpdateCalendarFilterTool();
    if (updateFilter) registrations.push(updateFilter);

    const getCurrentMonth = registerGetCurrentMonthTool(currentDate);
    if (getCurrentMonth) registrations.push(getCurrentMonth);

    console.log(`[WebMCP] Registered ${registrations.length} calendar page tools`);
    return registrations;
}
