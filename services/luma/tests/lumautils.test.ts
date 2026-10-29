import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { normalizeLumaPath } from '../supabase/functions/_shared/lumautils.ts';

describe('normalizeLumaPath', () => {
    it('strips protocol and host from full URLs', () => {
        expect(normalizeLumaPath('https://luma.com/DEVCONCebu')).toBe('DEVCONCebu');
        expect(normalizeLumaPath('https://lu.ma/awsugcebu')).toBe('awsugcebu');
        expect(normalizeLumaPath('http://luma.com/calendar/cal-Lm0SKVpU87TpADs')).toBe('calendar/cal-Lm0SKVpU87TpADs');
    });

    it('handles vanity slugs', () => {
        expect(normalizeLumaPath('DEVCONCebu')).toBe('DEVCONCebu');
        expect(normalizeLumaPath('awsugcebu')).toBe('awsugcebu');
        expect(normalizeLumaPath('notion.cebu')).toBe('notion.cebu');
    });

    it('handles user paths', () => {
        expect(normalizeLumaPath('user/lisksea')).toBe('user/lisksea');
        expect(normalizeLumaPath('https://luma.com/user/princejohn')).toBe('user/princejohn');
    });

    it('handles calendar paths with api_id', () => {
        expect(normalizeLumaPath('calendar/cal-Lm0SKVpU87TpADs')).toBe('calendar/cal-Lm0SKVpU87TpADs');
        expect(normalizeLumaPath('https://luma.com/calendar/cal-u9TD3AKbFGe7fld')).toBe('calendar/cal-u9TD3AKbFGe7fld');
    });

    it('strips query strings and fragments', () => {
        expect(normalizeLumaPath('https://luma.com/DEVCONCebu?ref=share')).toBe('DEVCONCebu');
        expect(normalizeLumaPath('https://luma.com/calendar/cal-123#section')).toBe('calendar/cal-123');
    });

    it('strips leading and trailing slashes', () => {
        expect(normalizeLumaPath('/DEVCONCebu/')).toBe('DEVCONCebu');
        expect(normalizeLumaPath('///user/handle///')).toBe('user/handle');
    });

    it('handles empty and whitespace input', () => {
        expect(normalizeLumaPath('')).toBe('');
        expect(normalizeLumaPath('   ')).toBe('');
    });
});
