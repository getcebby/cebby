/**
 * WebMCP Integration for Cebby
 *
 * Main entry point for WebMCP tool registration.
 * Exposes tools for in-browser AI agents to discover and interact with Cebu tech events.
 *
 * Usage:
 *   // In main layout or app initialization:
 *   import { registerGlobalTools } from '@/lib/webmcp';
 *   registerGlobalTools();
 *
 *   // On event detail pages:
 *   import { registerEventDetailTools } from '@/lib/webmcp';
 *   registerEventDetailTools(event);
 *
 *   // On calendar page:
 *   import { registerCalendarTools } from '@/lib/webmcp';
 *   registerCalendarTools(currentDate);
 */

export {
    isWebMcpSupported,
    registerGlobalTools,
    registerSearchEventsTool,
    registerGetEventTool,
    unregisterTools,
} from './tools';

export { registerEventDetailTools, registerGetCurrentEventTool } from './event-detail-tools';

export { registerCalendarTools, registerUpdateCalendarFilterTool, registerGetCurrentMonthTool } from './calendar-tools';

export type { ToolRegistration, ToolError } from './tools';
