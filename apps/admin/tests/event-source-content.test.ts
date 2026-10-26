import { describe, expect, it } from 'vitest';
import { deriveCanonicalEventUpdate, getSourceContentSnapshot } from '../src/lib/event-source-content';

const currentEvent = {
    id: 7,
    name: 'Old name',
    start_time: '2026-11-01T02:00:00.000Z',
    end_time: '2026-11-01T05:00:00.000Z',
};

function link(raw: unknown) {
    return { id: 42, event_id: 7, source: 'facebook', source_id: '123', url: null, raw };
}

describe('getSourceContentSnapshot', () => {
    it('decodes Facebook scraper epoch-second timestamps like the ingest does', () => {
        const snapshot = getSourceContentSnapshot(
            link({ name: 'FB event', startTimestamp: 1793260800, endTimestamp: 1793271600 }),
            currentEvent,
        );

        expect(snapshot.start_time).toBe(new Date(1793260800 * 1000).toISOString());
        expect(snapshot.end_time).toBe(new Date(1793271600 * 1000).toISOString());
    });

    it('treats a missing Facebook end timestamp as no end time', () => {
        const snapshot = getSourceContentSnapshot(
            link({ startTimestamp: 1793260800, endTimestamp: null }),
            currentEvent,
        );

        expect(snapshot.end_time).toBeNull();
    });

    it('still prefers string date fields from other sources', () => {
        const snapshot = getSourceContentSnapshot(
            link({ start_at: '2026-12-05T10:00:00.000Z', startTimestamp: 1793260800 }),
            currentEvent,
        );

        expect(snapshot.start_time).toBe('2026-12-05T10:00:00.000Z');
    });

    it('falls back to the current event when the source has no dates', () => {
        const snapshot = getSourceContentSnapshot(link({ name: 'No dates' }), currentEvent);

        expect(snapshot.start_time).toBe(currentEvent.start_time);
        expect(snapshot.end_time).toBe(currentEvent.end_time);
    });
});

describe('deriveCanonicalEventUpdate', () => {
    it('moves the schedule to the newly chosen Facebook source', () => {
        const update = deriveCanonicalEventUpdate(link({ startTimestamp: 1793260800 }), currentEvent);

        expect(update.start_time).toBe(new Date(1793260800 * 1000).toISOString());
        expect(update.primary_source_link_id).toBe(42);
    });
});
