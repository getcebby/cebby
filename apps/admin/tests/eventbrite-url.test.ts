import { describe, expect, it } from 'vitest';
import { isEventbriteHost } from '../src/lib/eventbrite-url';

describe('isEventbriteHost', () => {
    it('accepts eventbrite.com and its country sites', () => {
        for (const host of ['www.eventbrite.com', 'eventbrite.com', 'www.eventbrite.be', 'www.eventbrite.co.uk', 'www.eventbrite.com.au']) {
            expect(isEventbriteHost(host), host).toBe(true);
        }
    });

    it('rejects lookalike hosts', () => {
        for (const host of ['eventbrite.attacker.example', 'myeventbrite.com', 'www.eventbrite.com.evil.io', 'eventbrite.example.com']) {
            expect(isEventbriteHost(host), host).toBe(false);
        }
    });
});
