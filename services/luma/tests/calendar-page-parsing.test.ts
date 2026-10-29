import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Test the calendar page parsing logic for both vanity calendar pages
 * (luma.com/DEVCONCebu) and calendar/cal-... pages (luma.com/calendar/cal-...).
 * 
 * The key difference is where initialData sits in the __NEXT_DATA__ structure:
 * - Vanity pages: props.pageProps.initialData.data.featured_items
 * - Calendar pages: props.pageProps.initialData.featured_items (one level higher)
 */

// Mock HTML for a vanity calendar page (e.g., luma.com/DEVCONCebu)
const VANITY_CALENDAR_HTML = `
<!DOCTYPE html>
<html>
<head><title>DEVCON Cebu</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "initialData": {
        "data": {
          "calendar": {
            "api_id": "cal-u9TD3AKbFGe7fld",
            "name": "DEVCON Cebu",
            "slug": "DEVCONCebu",
            "is_personal": false
          },
          "has_upcoming_events": true,
          "featured_items": [
            {
              "event": {
                "api_id": "evt-test123",
                "name": "Test Event",
                "url": "test-event",
                "start_at": "2026-12-01T10:00:00+08:00"
              },
              "calendar": {
                "api_id": "cal-u9TD3AKbFGe7fld",
                "name": "DEVCON Cebu"
              }
            }
          ]
        }
      }
    }
  }
}
</script>
</body>
</html>
`;

// Mock HTML for a calendar/cal-... page (e.g., luma.com/calendar/cal-Lm0SKVpU87TpADs)
const CALENDAR_API_ID_HTML = `
<!DOCTYPE html>
<html>
<head><title>DevXchange</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "initialData": {
        "calendar": {
          "api_id": "cal-Lm0SKVpU87TpADs",
          "name": "DevXchange",
          "is_personal": false
        },
        "has_upcoming_events": false,
        "featured_items": []
      }
    }
  }
}
</script>
</body>
</html>
`;

// Mock HTML for a calendar/cal-... page with events
const CALENDAR_WITH_EVENTS_HTML = `
<!DOCTYPE html>
<html>
<head><title>DEVCON Cebu Calendar</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "initialData": {
        "calendar": {
          "api_id": "cal-u9TD3AKbFGe7fld",
          "name": "DEVCON Cebu",
          "is_personal": false
        },
        "has_upcoming_events": true,
        "featured_items": [
          {
            "event": {
              "api_id": "evt-abc456",
              "name": "Calendar Event",
              "url": "calendar-event",
              "start_at": "2026-12-15T14:00:00+08:00"
            },
            "calendar": {
              "api_id": "cal-u9TD3AKbFGe7fld",
              "name": "DEVCON Cebu"
            }
          }
        ]
      }
    }
  }
}
</script>
</body>
</html>
`;

describe('calendar page __NEXT_DATA__ extraction', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Mock global fetch
        fetchMock = vi.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('parses vanity calendar pages (data nested one level deeper)', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: async () => VANITY_CALENDAR_HTML,
        });

        // The actual parsing would happen in fetchCalendarEventStubs
        // This test verifies the structure is as expected
        const html = await (await fetch('https://luma.com/DEVCONCebu')).text();
        const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
        expect(match).toBeTruthy();
        
        const data = JSON.parse(match![1]);
        const nestedData = data?.props?.pageProps?.initialData?.data;
        
        expect(nestedData).toBeTruthy();
        expect(nestedData.calendar.api_id).toBe('cal-u9TD3AKbFGe7fld');
        expect(nestedData.featured_items).toHaveLength(1);
        expect(nestedData.featured_items[0].event.api_id).toBe('evt-test123');
    });

    it('parses calendar/cal-... pages (data at top level)', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: async () => CALENDAR_API_ID_HTML,
        });

        const html = await (await fetch('https://luma.com/calendar/cal-Lm0SKVpU87TpADs')).text();
        const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
        expect(match).toBeTruthy();
        
        const data = JSON.parse(match![1]);
        const topLevelData = data?.props?.pageProps?.initialData;
        
        // For calendar/cal-... pages, data is at initialData level, not initialData.data
        expect(topLevelData.calendar).toBeTruthy();
        expect(topLevelData.calendar.api_id).toBe('cal-Lm0SKVpU87TpADs');
        expect(topLevelData.featured_items).toBeDefined();
        expect(topLevelData.has_upcoming_events).toBe(false);
    });

    it('detects empty calendars via has_upcoming_events flag', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: async () => CALENDAR_API_ID_HTML,
        });

        const html = await (await fetch('https://luma.com/calendar/cal-Lm0SKVpU87TpADs')).text();
        const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
        const data = JSON.parse(match![1]);
        const topLevelData = data?.props?.pageProps?.initialData;
        
        expect(topLevelData.has_upcoming_events).toBe(false);
        expect(topLevelData.featured_items).toEqual([]);
    });

    it('handles calendar/cal-... pages with events', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: async () => CALENDAR_WITH_EVENTS_HTML,
        });

        const html = await (await fetch('https://luma.com/calendar/cal-u9TD3AKbFGe7fld')).text();
        const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
        const data = JSON.parse(match![1]);
        const topLevelData = data?.props?.pageProps?.initialData;
        
        expect(topLevelData.has_upcoming_events).toBe(true);
        expect(topLevelData.featured_items).toHaveLength(1);
        expect(topLevelData.featured_items[0].event.api_id).toBe('evt-abc456');
    });

    it('structure comparison: vanity vs calendar pages', () => {
        // Parse both fixtures
        const vanityMatch = VANITY_CALENDAR_HTML.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
        const calendarMatch = CALENDAR_API_ID_HTML.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
        
        const vanityData = JSON.parse(vanityMatch![1]);
        const calendarData = JSON.parse(calendarMatch![1]);
        
        // Vanity: data nested at initialData.data
        expect(vanityData.props.pageProps.initialData.data).toBeDefined();
        expect(vanityData.props.pageProps.initialData.data.featured_items).toBeDefined();
        
        // Calendar: data at initialData level (no .data property)
        expect(calendarData.props.pageProps.initialData.data).toBeUndefined();
        expect(calendarData.props.pageProps.initialData.featured_items).toBeDefined();
        
        // Both should have featured_items, just at different levels
        const vanityItems = vanityData.props.pageProps.initialData.data.featured_items;
        const calendarItems = calendarData.props.pageProps.initialData.featured_items;
        
        expect(Array.isArray(vanityItems)).toBe(true);
        expect(Array.isArray(calendarItems)).toBe(true);
    });
});
