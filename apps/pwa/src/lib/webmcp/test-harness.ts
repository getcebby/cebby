/**
 * WebMCP Test Harness & Development Mock
 *
 * Provides a polyfill/mock for testing WebMCP tools in browsers that don't
 * natively support the API. Useful for development and verification.
 *
 * Usage:
 *   1. Import this module before registering tools
 *   2. Set window.__WEBMCP_TEST_MODE = true to enable mock
 *   3. Use window.__WEBMCP_TEST_TOOLS to inspect registered tools
 *   4. Call tools via window.__WEBMCP_INVOKE(toolName, args)
 *
 * Example:
 *   <script type="module">
 *     import './lib/webmcp/test-harness';
 *     window.__WEBMCP_TEST_MODE = true;
 *     // ... register tools normally ...
 *     // Then:
 *     const result = await window.__WEBMCP_INVOKE('search_events', { keyword: 'tech' });
 *     console.log(result);
 *   </script>
 */

export interface MockTool {
    name: string;
    description: string;
    inputSchema: any;
    annotations: any;
    execute: (args: any) => Promise<any>;
}

// Global test state
declare global {
    interface Window {
        __WEBMCP_TEST_MODE?: boolean;
        __WEBMCP_TEST_TOOLS?: Map<string, MockTool>;
        __WEBMCP_INVOKE?: (toolName: string, args?: any) => Promise<any>;
        __WEBMCP_LIST_TOOLS?: () => void;
    }
}

// Mock implementation of document.modelContext
export function installWebMcpMock(): void {
    if (typeof window === 'undefined') return;

    // Initialize test tools registry
    window.__WEBMCP_TEST_TOOLS = new Map<string, MockTool>();

    // Helper to invoke a tool
    window.__WEBMCP_INVOKE = async (toolName: string, args: any = {}) => {
        const tool = window.__WEBMCP_TEST_TOOLS?.get(toolName);
        if (!tool) {
            throw new Error(`[WebMCP Mock] Tool not found: ${toolName}`);
        }
        console.log(`[WebMCP Mock] Invoking: ${toolName}`, args);
        const result = await tool.execute(args);
        console.log(`[WebMCP Mock] Result:`, result);
        return result;
    };

    // Helper to list all registered tools
    window.__WEBMCP_LIST_TOOLS = () => {
        console.log('[WebMCP Mock] Registered tools:');
        window.__WEBMCP_TEST_TOOLS?.forEach((tool, name) => {
            console.log(`  - ${name}: ${tool.description}`);
            console.log(`    Schema:`, tool.inputSchema);
            console.log(`    Annotations:`, tool.annotations);
        });
    };

    // Mock document.modelContext
    const mockContext = {
        registerTool(
            tool: {
                name: string;
                description: string;
                inputSchema: any;
                annotations: any;
                execute: (args: any) => Promise<any>;
            },
            options?: { signal?: AbortSignal },
        ): void {
            console.log(`[WebMCP Mock] Registering tool: ${tool.name}`);
            window.__WEBMCP_TEST_TOOLS?.set(tool.name, tool);

            // Handle abort signal
            if (options?.signal) {
                options.signal.addEventListener('abort', () => {
                    console.log(`[WebMCP Mock] Unregistering tool: ${tool.name}`);
                    window.__WEBMCP_TEST_TOOLS?.delete(tool.name);
                });
            }
        },
    };

    // Install the mock on document
    Object.defineProperty(document, 'modelContext', {
        value: mockContext,
        writable: false,
        configurable: true,
    });

    console.log('[WebMCP Mock] Test harness installed. Use window.__WEBMCP_INVOKE() to test tools.');
}

// Auto-install if test mode is enabled
if (typeof window !== 'undefined' && window.__WEBMCP_TEST_MODE) {
    installWebMcpMock();
}

/**
 * Standalone test suite for WebMCP tools
 *
 * Run this to verify all tools work correctly.
 */
export async function runWebMcpTests(): Promise<void> {
    if (!window.__WEBMCP_TEST_MODE) {
        console.error('[WebMCP Tests] Test mode not enabled. Set window.__WEBMCP_TEST_MODE = true first.');
        return;
    }

    if (!window.__WEBMCP_INVOKE) {
        console.error('[WebMCP Tests] Mock not installed.');
        return;
    }

    console.log('[WebMCP Tests] Starting test suite...');

    const results: { test: string; passed: boolean; error?: string }[] = [];

    // Test 1: search_events with no filters
    try {
        console.log('\n[Test 1] search_events (no filters)');
        const result = await window.__WEBMCP_INVOKE('search_events', {});
        if (result.error) {
            throw new Error(result.error);
        }
        if (!Array.isArray(result.results)) {
            throw new Error('Expected results array');
        }
        console.log(`✓ Found ${result.count} events`);
        results.push({ test: 'search_events (no filters)', passed: true });
    } catch (err) {
        console.error('✗ Test failed:', err);
        results.push({
            test: 'search_events (no filters)',
            passed: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }

    // Test 2: search_events with keyword
    try {
        console.log('\n[Test 2] search_events (keyword: "tech")');
        const result = await window.__WEBMCP_INVOKE('search_events', { keyword: 'tech' });
        if (result.error) {
            throw new Error(result.error);
        }
        console.log(`✓ Found ${result.count} tech events`);
        results.push({ test: 'search_events (keyword)', passed: true });
    } catch (err) {
        console.error('✗ Test failed:', err);
        results.push({
            test: 'search_events (keyword)',
            passed: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }

    // Test 3: search_events with city filter
    try {
        console.log('\n[Test 3] search_events (city: "Cebu City")');
        const result = await window.__WEBMCP_INVOKE('search_events', { city: 'Cebu City' });
        if (result.error) {
            throw new Error(result.error);
        }
        console.log(`✓ Found ${result.count} events in Cebu City`);
        results.push({ test: 'search_events (city)', passed: true });
    } catch (err) {
        console.error('✗ Test failed:', err);
        results.push({
            test: 'search_events (city)',
            passed: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }

    // Test 4: search_events with free filter
    try {
        console.log('\n[Test 4] search_events (is_free: true)');
        const result = await window.__WEBMCP_INVOKE('search_events', { is_free: true });
        if (result.error) {
            throw new Error(result.error);
        }
        console.log(`✓ Found ${result.count} free events`);
        results.push({ test: 'search_events (is_free)', passed: true });
    } catch (err) {
        console.error('✗ Test failed:', err);
        results.push({
            test: 'search_events (is_free)',
            passed: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }

    // Test 5: get_event (requires finding an event first)
    try {
        console.log('\n[Test 5] get_event');
        // First find an event
        const searchResult = await window.__WEBMCP_INVOKE('search_events', { limit: 1 });
        if (searchResult.error || !searchResult.results?.[0]) {
            throw new Error('No events found to test get_event');
        }
        const eventUrl = searchResult.results[0].url;
        console.log(`  Using event: ${eventUrl}`);
        
        const result = await window.__WEBMCP_INVOKE('get_event', { slug_or_url: eventUrl });
        if (result.error) {
            throw new Error(result.error);
        }
        if (!result.event) {
            throw new Error('Expected event object');
        }
        console.log(`✓ Retrieved event: ${result.event.name}`);
        results.push({ test: 'get_event', passed: true });
    } catch (err) {
        console.error('✗ Test failed:', err);
        results.push({
            test: 'get_event',
            passed: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }

    // Print summary
    console.log('\n[WebMCP Tests] Summary:');
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    console.log(`  Passed: ${passed}/${total}`);
    
    results.forEach((r) => {
        if (r.passed) {
            console.log(`  ✓ ${r.test}`);
        } else {
            console.log(`  ✗ ${r.test}: ${r.error}`);
        }
    });

    if (passed === total) {
        console.log('\n✓ All tests passed!');
    } else {
        console.log(`\n✗ ${total - passed} test(s) failed`);
    }
}

// Export helper to run tests from console
if (typeof window !== 'undefined') {
    (window as any).__WEBMCP_RUN_TESTS = runWebMcpTests;
}
