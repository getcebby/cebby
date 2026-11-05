import { describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { countsForCebby, isInCebu, type PhysicalPlace } from '../supabase/shared/cebu-rule.ts';
import { normalizeCity } from '../supabase/shared/search-doc.ts';

/** A physical place with every field unset unless given. */
function place(fields: Partial<PhysicalPlace>): PhysicalPlace {
    return { city: null, region: null, country: null, address: null, ...fields };
}

const cebu = place({ city: 'Cebu City', region: 'Central Visayas', country: 'PH' });
const makati = place({ city: 'Makati City', region: 'Metro Manila', country: 'PH' });

describe('countsForCebby', () => {
    it('counts an event held in Cebu, whoever organizes it', () => {
        expect(countsForCebby({ online: false, ...cebu }, true)).toBe(true);
        expect(countsForCebby({ online: false, ...cebu }, false)).toBe(true);
    });

    it('counts an online event only from a Cebu-based account', () => {
        expect(countsForCebby({ online: true }, true)).toBe(true);
        expect(countsForCebby({ online: true }, false)).toBe(false);
    });

    it('never counts an event held outside Cebu', () => {
        expect(countsForCebby({ online: false, ...makati }, true)).toBe(false);
        expect(countsForCebby({ online: false, ...makati }, false)).toBe(false);
    });
});

describe('isInCebu', () => {
    it('accepts Cebu City, its neighbouring cities and Cebu City areas', () => {
        expect(isInCebu(cebu)).toBe(true);
        expect(isInCebu(place({ city: 'Mandaue City', country: 'PH' }))).toBe(true);
        expect(isInCebu(place({ city: 'Lapu-Lapu City' }))).toBe(true);
        expect(isInCebu(place({ address: 'IT Park, Lahug' }))).toBe(true);
    });

    it('accepts another Cebu town when the place also says Cebu', () => {
        expect(isInCebu(place({ city: 'Talisay City', region: 'Cebu', country: 'PH' }))).toBe(true);
    });

    it('accepts a bare "Cebu" (the city or the province, both in scope)', () => {
        expect(isInCebu(place({ city: 'Cebu', country: 'PH' }))).toBe(true);
    });

    it('rejects places abroad, even ones named Cebu', () => {
        expect(isInCebu(place({ city: 'Kecamatan Ubud', region: 'Bali', country: 'ID' }))).toBe(false);
        expect(isInCebu(place({ city: 'Cebu City', country: 'US' }))).toBe(false);
    });

    it('rejects Philippine towns that share a name with a Cebu town', () => {
        expect(isInCebu(place({ city: 'Naga City', region: 'Camarines Sur', country: 'PH' }))).toBe(false);
        expect(isInCebu(place({ city: 'Talisay City', region: 'Negros Occidental', country: 'PH' }))).toBe(false);
        expect(isInCebu(place({ city: 'Danao', region: 'Bohol', country: 'PH' }))).toBe(false);
        expect(isInCebu(place({ city: 'Compostela', region: 'Davao de Oro', country: 'PH' }))).toBe(false);
    });

    it('rejects Metro Manila places named like Cebu City areas (Ayala, Guadalupe, Business Park)', () => {
        expect(isInCebu(place({ city: 'Makati City', region: 'Metro Manila', country: 'PH', address: 'Ayala Avenue, Makati' })))
            .toBe(false);
        expect(isInCebu(place({ address: 'Ayala Avenue, Makati' }))).toBe(false);
        expect(isInCebu(place({ address: 'Guadalupe Nuevo, Makati' }))).toBe(false);
        expect(isInCebu(place({ address: 'Ayala Center Cebu, Cebu Business Park' }))).toBe(true);
    });

    it('rejects a place with nothing that says where it is', () => {
        expect(isInCebu(place({}))).toBe(false);
    });
});

describe('normalizeCity after the town matcher moved', () => {
    it('keeps its answers', () => {
        expect(normalizeCity({ city: 'Mandaue City', location: null, format: 'in_person' })).toBe('Mandaue');
        expect(normalizeCity({ city: 'Cebu', location: null, format: 'in_person' })).toBe(null);
    });
});
