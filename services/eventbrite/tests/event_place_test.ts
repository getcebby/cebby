import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { countsForCebby } from '@service/core/supabase/shared/cebu-rule.ts';
import { parseEventbriteEventPage, toIngestEvent } from '../supabase/functions/_shared/eventbriteutils.ts';
import { placeOfEventbriteEvent, withCebuAnchor } from '../supabase/functions/_shared/event-place.ts';
import type { EventbriteEvent } from '../supabase/functions/_shared/types.ts';

const html = Deno.readTextFileSync(new URL('./fixtures/bitcoin-meetup-occurrence.html', import.meta.url));
const page = parseEventbriteEventPage(html, 'https://www.eventbrite.com/e/2002279263176');
if (page?.kind !== 'event') throw new Error('fixture should parse as one event');
const cebuEvent: EventbriteEvent = page.event;
const onlineEvent: EventbriteEvent = { ...cebuEvent, location: 'Online', venue: null };

describe('placeOfEventbriteEvent', () => {
    it("places a Cebu date at its venue, which counts for any organizer", () => {
        const place = placeOfEventbriteEvent(cebuEvent);
        expect(place.online).toBe(false);
        expect(countsForCebby(place, false)).toBe(true);
    });

    it('places an online event online', () => {
        expect(placeOfEventbriteEvent(onlineEvent)).toEqual({ online: true });
    });
});

describe('withCebuAnchor', () => {
    const online = { ...toIngestEvent(onlineEvent, 'org'), city: null, region: null, country: null };
    const inPerson = toIngestEvent(cebuEvent, 'org');

    it("tags a Cebu-based organizer's online event with Cebu, as Luma does", () => {
        const tagged = withCebuAnchor(online, true);
        expect([tagged.city, tagged.region, tagged.country]).toEqual(['Cebu City', 'Central Visayas', 'Philippines']);
    });

    it('leaves other events as they are', () => {
        expect(withCebuAnchor(online, false)).toEqual(online);
        expect(withCebuAnchor(inPerson, true)).toEqual(inPerson);
    });
});
