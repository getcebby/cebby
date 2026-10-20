# WebMCP Integration for Cebby

This directory contains the WebMCP (Web Model Context Protocol) integration for the Cebby PWA. WebMCP is a W3C WebML Community Group draft browser API that allows web pages to register tools for in-browser AI agents.

## Overview

WebMCP enables browser-based AI agents to discover and interact with Cebu tech events directly from the Cebby website. All tools are **read-only** and follow the principle of progressive enhancement: visitors using non-WebMCP browsers experience zero impact.

**Important**: This is **NOT** an MCP server. WebMCP is a browser API for client-side tool registration. The W3C spec draft is still evolving (as of October 2026), and no browser ships it by default yet.

## Specification & References

- **W3C WebML CG Draft**: [WebMCP Agentic JavaScript Tools](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/webmcp/agentic-javascript-tools.md)
- **Chrome Documentation**: [WebMCP Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)

## Registered Tools

### Global Tools (all pages)

#### `search_events`
Search Cebu tech events with optional filters.

**Parameters:**
- `keyword` (string, optional): Search term for event name, description, or organizer
- `date_start` (string, optional): ISO 8601 start date (defaults to today)
- `date_end` (string, optional): ISO 8601 end date
- `city` (string, optional): One of "Cebu City", "Mandaue", "Lapu-Lapu"
- `is_free` (boolean, optional): Filter to free events only
- `format` (string, optional): "online" or "in-person"
- `limit` (number, optional): Max results (1-50, default 20)

**Returns:**
```json
{
  "results": [
    {
      "name": "Tech Talk: Building with AI",
      "start": "2026-10-25T18:00:00+08:00",
      "end": "2026-10-25T20:00:00+08:00",
      "city": "Cebu City",
      "venue": "The Company Cebu",
      "is_free": true,
      "url": "https://www.getcebby.com/events/tech-talk-building-with-ai"
    }
  ],
  "count": 1
}
```

**Annotations:**
- `readOnlyHint: true`
- `untrustedContentHint: false`
- `consequentialHint: false`

---

#### `get_event`
Fetch full event details by slug or URL.

**Parameters:**
- `slug_or_url` (string, required): Event slug (e.g., "techtalks-cebu") or full getcebby.com URL

**Returns:**
```json
{
  "event": {
    "id": "123",
    "name": "Tech Talk: Building with AI",
    "description": "Join us for an evening of...",
    "start_time": "2026-10-25T18:00:00+08:00",
    "end_time": "2026-10-25T20:00:00+08:00",
    "location": "The Company Cebu",
    "is_free": true,
    "is_online": false,
    "canonical_url": "https://www.getcebby.com/events/techtalks-cebu",
    "organizers": ["Tech Community Cebu"],
    "source_links": [
      { "source": "facebook", "url": "https://facebook.com/events/..." }
    ]
  }
}
```

**Annotations:**
- `readOnlyHint: true`
- `untrustedContentHint: true` (descriptions are scraped from external sources)
- `consequentialHint: false`

---

### Page-Scoped Tools

#### `get_current_event` (event detail pages only)
Returns the event currently displayed on `/events/[slug]` pages. Same return format as `get_event` but no parameters needed.

**Annotations:**
- `readOnlyHint: true`
- `untrustedContentHint: true`
- `consequentialHint: false`

---

#### `update_calendar_filter` (calendar page only)
Navigate the calendar to a specific month.

**Parameters:**
- `year` (number, required): Year to display (2020-2030)
- `month` (number, required): Month to display (1-12, where 1 = January)

**Returns:**
```json
{
  "success": true,
  "url": "https://www.getcebby.com/calendar?date=2026-11-01"
}
```

**Annotations:**
- `readOnlyHint: true` (only affects UI state, no data mutations)
- `untrustedContentHint: false`
- `consequentialHint: false`

---

#### `get_current_calendar_month` (calendar page only)
Get the month currently displayed on the calendar.

**Returns:**
```json
{
  "year": 2026,
  "month": 10,
  "monthName": "October 2026"
}
```

**Annotations:**
- `readOnlyHint: true`
- `untrustedContentHint: false`
- `consequentialHint: false`

---

## Architecture

### Feature Detection
All code uses feature detection to ensure zero impact on non-supporting browsers:

```typescript
export function isWebMcpSupported(): boolean {
    return 'modelContext' in document;
}
```

If not supported, tool registration is a no-op and normal visitors experience no change.

### Module Structure

```
lib/webmcp/
├── index.ts                 # Main entry point, re-exports
├── tools.ts                 # Global tools (search_events, get_event)
├── event-detail-tools.ts    # Page-scoped tools for /events/[slug]
├── calendar-tools.ts        # Page-scoped tools for /calendar
└── test-harness.ts          # Dev mock/polyfill and test suite
```

### Integration Points

1. **Main Layout** (`src/layouts/Layout.astro`): Registers global tools on every page
2. **Event Detail Page** (`src/pages/events/[slug].astro`): Registers `get_current_event` tool
3. **Calendar Page** (`src/pages/calendar.astro`): Registers calendar-specific tools

### Data Access Patterns

Tools use the existing Supabase client and public/anonymous queries. No new write paths or service-role keys are exposed. All queries respect the same visibility rules the site already enforces (published events only, no hidden content).

## Development & Testing

### Test Harness

The test harness provides a mock implementation for development and testing in browsers without native WebMCP support.

#### Enable Test Mode

Add this to your page before registering tools:

```html
<script type="module">
  import '/src/lib/webmcp/test-harness.ts';
  window.__WEBMCP_TEST_MODE = true;
  // ... normal tool registration continues ...
</script>
```

#### Inspect Registered Tools

```javascript
// List all tools
window.__WEBMCP_LIST_TOOLS();

// Invoke a tool
const result = await window.__WEBMCP_INVOKE('search_events', { 
  keyword: 'tech',
  is_free: true 
});
console.log(result);
```

#### Run Test Suite

```javascript
// Run all tests
await window.__WEBMCP_RUN_TESTS();
```

The test suite exercises:
- `search_events` with various filter combinations
- `get_event` by URL and slug
- Error handling
- Schema validation

### Local Development

1. Enable test mode in your browser console:
   ```javascript
   window.__WEBMCP_TEST_MODE = true;
   location.reload();
   ```

2. Use the browser console to test tools:
   ```javascript
   // Search for tech events in Cebu City
   await window.__WEBMCP_INVOKE('search_events', {
     keyword: 'tech',
     city: 'Cebu City',
     limit: 5
   });
   ```

3. Run the full test suite:
   ```javascript
   await window.__WEBMCP_RUN_TESTS();
   ```

## Error Handling

Tools never throw errors to the agent. Instead, they return structured error payloads:

```typescript
interface ToolError {
  error: string;
  code?: string;
}
```

Example:
```json
{
  "error": "Event not found",
  "code": "NOT_FOUND"
}
```

This design follows the WebMCP spec guideline that errors thrown in `execute` aren't forwarded to agents, so tools must return structured error objects.

## Security & Privacy

- **Read-only**: All tools are read-only. No write, update, or delete operations.
- **Public data only**: Tools expose only published events visible to anonymous users.
- **No auth exposure**: No user credentials, session tokens, or service-role keys are accessible.
- **Untrusted content**: Event descriptions are marked with `untrustedContentHint: true` since they're scraped from external sources (Facebook, Luma, Meetup).
- **No PII**: Tools don't expose personal information, email addresses, or registration details.

## Bundle Size Impact

- **Zero impact on non-supporting browsers**: Tool registration is feature-detected and conditionally loaded.
- **Lazy-loaded**: The WebMCP module is loaded as a separate ES module, not bundled into the main app.
- **Minimal footprint**: Core tools module is ~6KB minified (gzipped).

## Future Enhancements (Out of Scope for This PR)

- **Write tools**: `suggest_event`, `submit_event` (requires authentication)
- **RSVP tools**: `rsvp_to_event`, `cancel_rsvp` (requires authentication)
- **Personalization**: `get_my_saved_events`, `save_event` (requires authentication)

## Browser Support

WebMCP is a draft specification. As of October 2026:
- **Chrome/Edge**: Experimental flag required (`chrome://flags/#enable-webmcp`)
- **Safari**: Not implemented
- **Firefox**: Not implemented

Feature detection ensures the site works perfectly in all browsers, with tools available as progressive enhancement where supported.

## License

Same as the main Cebby project.
