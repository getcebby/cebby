/**
 * WebMCP Integration for Cebby
 *
 * Main entry point for WebMCP tool registration.
 * Exposes tools for in-browser AI agents to discover and interact with Cebu tech events.
 *
 * Usage: create one AbortController per page lifetime *before* loading this
 * module, and abort it on pagehide. Aborting unregisters every tool registered
 * with its signal, including registrations still in flight.
 *
 *   // In main layout or app initialization:
 *   import { registerGlobalTools } from '@/lib/webmcp';
 *   registerGlobalTools(controller.signal);
 *
 *   // On event detail pages:
 *   import { registerEventDetailTools } from '@/lib/webmcp';
 *   registerEventDetailTools(event, controller.signal);
 *
 *   // On calendar page:
 *   import { registerCalendarTools } from '@/lib/webmcp';
 *   registerCalendarTools({ year, month, monthName }, controller.signal);
 */

export {
    isWebMcpSupported,
    registerGlobalTools,
    registerSearchEventsTool,
    registerGetEventTool,
} from './tools';

export { registerEventDetailTools, registerGetCurrentEventTool } from './event-detail-tools';

export { registerCalendarTools, registerUpdateCalendarFilterTool, registerGetCurrentMonthTool } from './calendar-tools';

export type { ToolError } from './tools';
export type { CalendarMonth } from './calendar-tools';
