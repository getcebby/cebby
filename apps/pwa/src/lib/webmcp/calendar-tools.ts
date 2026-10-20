/**
 * WebMCP Tools for Calendar Page
 *
 * Page-scoped tools for /calendar that allow agents to interact with
 * the calendar view and filtering UI state (read-only, no mutations).
 */

import type { ToolError } from './tools';
import { invalidParams, isIntegerInRange, isWebMcpSupported } from './tools';

// The month the server rendered, read from the page. Recomputing it in the
// browser from a timestamp can land in a different month when the browser's
// timezone differs from the server's.
export interface CalendarMonth {
    year: number;
    month: number;
    monthName: string;
}

/**
 * Update Calendar Filter Tool
 *
 * Updates the visible calendar by navigating to a new month.
 * Only available on /calendar page.
 */
export async function registerUpdateCalendarFilterTool(signal: AbortSignal): Promise<string | null> {
    if (!isWebMcpSupported() || signal.aborted) return null;

    try {
        await (document as any).modelContext.registerTool(
            {
                name: 'update_calendar_filter',
                description:
                    'Update the calendar view to show a specific month. Only available on /calendar page. Changes the visible month by navigating to the new URL.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        year: {
                            type: 'integer',
                            description: 'Year to display (e.g., 2026)',
                            minimum: 2020,
                            maximum: 2030,
                        },
                        month: {
                            type: 'integer',
                            description: 'Month to display (1-12, where 1 = January)',
                            minimum: 1,
                            maximum: 12,
                        },
                    },
                    required: ['year', 'month'],
                    additionalProperties: false,
                },
                annotations: {
                    readOnlyHint: false,
                    untrustedContentHint: false,
                    consequentialHint: false,
                },
                async execute(args: {
                    year: number;
                    month: number;
                }): Promise<{ success: boolean; url: string } | ToolError> {
                    try {
                        if (!isIntegerInRange(args?.year, 2020, 2030)) {
                            return invalidParams('year must be an integer from 2020 to 2030');
                        }
                        if (!isIntegerInRange(args?.month, 1, 12)) {
                            return invalidParams('month must be an integer from 1 to 12');
                        }

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
            { signal },
        );

        console.log('[WebMCP] Registered: update_calendar_filter (page-scoped)');
        return 'update_calendar_filter';
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
export async function registerGetCurrentMonthTool(
    displayed: CalendarMonth,
    signal: AbortSignal,
): Promise<string | null> {
    if (!isWebMcpSupported() || signal.aborted) return null;

    try {
        await (document as any).modelContext.registerTool(
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
                async execute(): Promise<CalendarMonth> {
                    const { year, month, monthName } = displayed;
                    return { year, month, monthName };
                },
            },
            { signal },
        );

        console.log('[WebMCP] Registered: get_current_calendar_month (page-scoped)');
        return 'get_current_calendar_month';
    } catch (err) {
        console.error('[WebMCP] Failed to register get_current_calendar_month:', err);
        return null;
    }
}

/**
 * Register all calendar page tools.
 * Call this from the calendar page script; aborting `signal` unregisters them.
 */
export async function registerCalendarTools(displayed: CalendarMonth, signal: AbortSignal): Promise<string[]> {
    if (!isWebMcpSupported()) {
        return [];
    }

    console.log('[WebMCP] Registering calendar page tools...');

    const registered: string[] = [];

    const updateFilter = await registerUpdateCalendarFilterTool(signal);
    if (updateFilter) registered.push(updateFilter);

    const getCurrentMonth = await registerGetCurrentMonthTool(displayed, signal);
    if (getCurrentMonth) registered.push(getCurrentMonth);

    console.log(`[WebMCP] Registered ${registered.length} calendar page tools`);
    return registered;
}
