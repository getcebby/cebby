/**
 * Tiny Deno smoke for URL parsing (no network).
 *   deno run services/eventbrite/scripts/parse-url-smoke.ts
 */
import { parseEventbriteEventUrl } from '../supabase/functions/_shared/eventbriteutils.ts';

const samples = [
    'https://www.eventbrite.be/e/aicd-cebu-tickets-1993845961945',
    'https://www.eventbrite.com/e/some-event-1234567890/',
    'https://www.eventbrite.com/e/1234567890',
    'https://lu.ma/nope',
    'https://eventbrite.attacker.example/e/x-123',
];

for (const s of samples) {
    console.log(s, '→', parseEventbriteEventUrl(s));
}
