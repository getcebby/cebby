import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Typesense from 'npm:typesense@2';
import { recordServiceHealthEvent } from '@service/core/supabase/shared/service-health.ts';
import {
    EVENT_SEARCH_SELECT,
    eventToSearchDoc,
    type EventSearchDoc,
    type EventSearchRow,
} from '@service/core/supabase/shared/search-doc.ts';

// ----------------------------------------------------------------------------
// Realtime Typesense sync — single-event upsert/delete.
//
// Invoked by Postgres triggers (see migrations/20260430030000_typesense_sync_trigger.sql)
// whenever a row in public.events changes. Body: { event_id: number }.
//
// Behavior:
//   • Event row exists + status != 'hidden' → upsert to Typesense
//   • Event row missing or hidden          → delete from Typesense
//
// The nightly batch sync (.github/workflows/sync-typesense.yml) remains as
// a safety net to catch any drift; this function keeps search current
// in near-real-time.
//
// Required Edge Function secrets (set via `supabase secrets set`):
//   TYPESENSE_HOST           — e.g. typesense.gocebby.com
//   TYPESENSE_PORT           — e.g. 443
//   TYPESENSE_PROTOCOL       — e.g. https
//   TYPESENSE_ADMIN_KEY      — admin key with documents:write
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected.
// ----------------------------------------------------------------------------

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TS_HOST = Deno.env.get('TYPESENSE_HOST');
const TS_PORT = parseInt(Deno.env.get('TYPESENSE_PORT') ?? '443', 10);
const TS_PROTOCOL = (Deno.env.get('TYPESENSE_PROTOCOL') ?? 'https') as 'http' | 'https';
const TS_KEY = Deno.env.get('TYPESENSE_ADMIN_KEY');

if (!TS_HOST || !TS_KEY) {
    console.error('[ts-sync] TYPESENSE_HOST or TYPESENSE_ADMIN_KEY not set; function will reject all calls');
}

const supabase = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

const typesense = TS_HOST && TS_KEY
    ? new Typesense.Client({
        nodes: [{ host: TS_HOST, port: TS_PORT, protocol: TS_PROTOCOL }],
        apiKey: TS_KEY,
        connectionTimeoutSeconds: 5,
    })
    : null;

async function deleteFromTypesense(
    eventId: number,
): Promise<{ ok: boolean; status: 'deleted' | 'absent' | 'error'; error?: string }> {
    if (!typesense) return { ok: false, status: 'error', error: 'typesense client not configured' };
    try {
        await typesense.collections('events').documents(String(eventId)).delete();
        return { ok: true, status: 'deleted' };
    } catch (err) {
        // 404 = already gone, treat as success (idempotent).
        const httpStatus = (err as { httpStatus?: number })?.httpStatus;
        if (httpStatus === 404) return { ok: true, status: 'absent' };
        return { ok: false, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
}

async function upsertToTypesense(
    doc: EventSearchDoc,
): Promise<{ ok: boolean; status: 'upserted' | 'error'; error?: string }> {
    if (!typesense) return { ok: false, status: 'error', error: 'typesense client not configured' };
    try {
        await typesense.collections('events').documents().upsert(doc);
        return { ok: true, status: 'upserted' };
    } catch (err) {
        return { ok: false, status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    let body: { event_id?: number | string };
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400 });
    }

    const eventId = typeof body.event_id === 'string' ? parseInt(body.event_id, 10) : body.event_id;
    if (!eventId || !Number.isFinite(eventId)) {
        return new Response(JSON.stringify({ error: 'event_id required (number)' }), { status: 400 });
    }

    // Fetch with all the joined fields the indexed doc needs — the same
    // select the nightly batch uses, so both build identical documents.
    const { data, error } = await supabase
        .from('events')
        .select(EVENT_SEARCH_SELECT)
        .eq('id', eventId)
        .maybeSingle();

    if (error) {
        console.error(`[ts-sync] db error for event ${eventId}:`, error.message);
        await recordServiceHealthEvent({
            bucket: 'typesense',
            source: 'sync-event',
            status: 'error',
            severity: 'error',
            fingerprint: 'db_error',
            message: error.message,
            metadata: { event_id: eventId },
        });
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    // Treat 'hidden' the same as deleted for search — admin suppression
    // should remove the event from results immediately.
    if (!data || data.status === 'hidden') {
        const result = await deleteFromTypesense(eventId);
        const code = result.ok ? 200 : 500;
        console.log(`[ts-sync] event ${eventId} ${result.status}${result.error ? `: ${result.error}` : ''}`);
        await recordServiceHealthEvent({
            bucket: 'typesense',
            source: 'sync-event',
            status: result.ok ? 'success' : 'error',
            severity: result.ok ? 'info' : 'error',
            fingerprint: result.ok ? `event_${result.status}` : 'typesense_delete_failed',
            message: result.error ?? `event ${eventId} ${result.status}`,
            metadata: { event_id: eventId, result },
        });
        return new Response(JSON.stringify({ event_id: eventId, ...result }), {
            status: code,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const doc = eventToSearchDoc(data as unknown as EventSearchRow);
    const result = await upsertToTypesense(doc);
    const code = result.ok ? 200 : 500;
    console.log(`[ts-sync] event ${eventId} ${result.status}${result.error ? `: ${result.error}` : ''}`);
    await recordServiceHealthEvent({
        bucket: 'typesense',
        source: 'sync-event',
        status: result.ok ? 'success' : 'error',
        severity: result.ok ? 'info' : 'error',
        fingerprint: result.ok ? 'event_upserted' : 'typesense_upsert_failed',
        message: result.error ?? `event ${eventId} ${result.status}`,
        metadata: { event_id: eventId, result },
    });
    return new Response(JSON.stringify({ event_id: eventId, ...result }), {
        status: code,
        headers: { 'Content-Type': 'application/json' },
    });
});
