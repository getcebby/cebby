import { describe, expect, it } from 'vitest';

/**
 * Path normalization logic extracted from the discovery-path API route.
 * This matches the normalization performed when setting discovery_path.
 */
function normalizeDiscoveryPath(rawPath: string): string | null {
    const trimmed = rawPath.trim();
    if (trimmed.length === 0) return null;
    
    return trimmed
        .replace(/^https?:\/\//i, '')
        .replace(/^lu\.ma\//i, '')
        .replace(/^luma\.com\//i, '')
        .replace(/^\/+/, '')
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '');
}

describe('discovery_path normalization', () => {
    it('normalizes full Luma URLs to bare paths', () => {
        expect(normalizeDiscoveryPath('https://luma.com/DEVCONCebu')).toBe('DEVCONCebu');
        expect(normalizeDiscoveryPath('https://lu.ma/awsugcebu')).toBe('awsugcebu');
        expect(normalizeDiscoveryPath('http://luma.com/notion.cebu')).toBe('notion.cebu');
    });

    it('accepts vanity slugs as-is', () => {
        expect(normalizeDiscoveryPath('DEVCONCebu')).toBe('DEVCONCebu');
        expect(normalizeDiscoveryPath('awsugcebu')).toBe('awsugcebu');
        expect(normalizeDiscoveryPath('notion.cebu')).toBe('notion.cebu');
    });

    it('handles user/<handle> format', () => {
        expect(normalizeDiscoveryPath('user/lisksea')).toBe('user/lisksea');
        expect(normalizeDiscoveryPath('https://luma.com/user/princejohn')).toBe('user/princejohn');
        expect(normalizeDiscoveryPath('user/handle123')).toBe('user/handle123');
    });

    it('handles calendar/cal-... format', () => {
        expect(normalizeDiscoveryPath('calendar/cal-Lm0SKVpU87TpADs')).toBe('calendar/cal-Lm0SKVpU87TpADs');
        expect(normalizeDiscoveryPath('https://luma.com/calendar/cal-u9TD3AKbFGe7fld')).toBe('calendar/cal-u9TD3AKbFGe7fld');
        expect(normalizeDiscoveryPath('calendar/cal-123ABC456def')).toBe('calendar/cal-123ABC456def');
    });

    it('strips query strings and URL fragments', () => {
        expect(normalizeDiscoveryPath('https://luma.com/DEVCONCebu?utm_source=twitter')).toBe('DEVCONCebu');
        expect(normalizeDiscoveryPath('DEVCONCebu?ref=share')).toBe('DEVCONCebu');
        expect(normalizeDiscoveryPath('calendar/cal-123#upcoming')).toBe('calendar/cal-123');
        expect(normalizeDiscoveryPath('https://luma.com/user/handle?tab=events#past')).toBe('user/handle');
    });

    it('strips leading and trailing slashes', () => {
        expect(normalizeDiscoveryPath('/DEVCONCebu/')).toBe('DEVCONCebu');
        expect(normalizeDiscoveryPath('///user/handle///')).toBe('user/handle');
        expect(normalizeDiscoveryPath('/calendar/cal-123/')).toBe('calendar/cal-123');
    });

    it('treats empty or whitespace input as null (clear path)', () => {
        expect(normalizeDiscoveryPath('')).toBe(null);
        expect(normalizeDiscoveryPath('   ')).toBe(null);
        expect(normalizeDiscoveryPath('\t\n')).toBe(null);
    });

    it('preserves case', () => {
        expect(normalizeDiscoveryPath('DEVCONCebu')).toBe('DEVCONCebu');
        expect(normalizeDiscoveryPath('calendar/cal-AbCdEf')).toBe('calendar/cal-AbCdEf');
    });

    it('handles lu.ma shortlinks', () => {
        expect(normalizeDiscoveryPath('https://lu.ma/gdgcebu')).toBe('gdgcebu');
        expect(normalizeDiscoveryPath('lu.ma/awsugcebu')).toBe('awsugcebu');
    });
});
