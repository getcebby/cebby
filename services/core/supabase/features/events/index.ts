import { supabase } from '../../shared/client.ts';
import {
    Account,
    Event,
    EventSlugInsert,
    EventUpdate,
    IngestEvent,
    IngestResult,
} from '../../shared/types.ts';
import { generateEventSlug } from './utils.ts';
import { geocodeLocation, looksLikeOnlineEvent } from '../../shared/geocode.ts';
import { PutObjectCommand, S3Client } from 'npm:@aws-sdk/client-s3@3';

// --- Source priority -----------------------------------------------------------

/**
 * Default ordering when an organization hasn't set its own source_priority.
 * Luma first because RSVP-as-source-of-truth means hosts keep it most current;
 * FB second (often cross-posted, less maintained); the rest are tail-end.
 */
const DEFAULT_SOURCE_PRIORITY = ['luma', 'facebook', 'meetup', 'eventbrite', 'website'];

function rankOf(source: string, priority: string[]): number {
    const idx = priority.indexOf(source);
    // Sources not in the priority list rank last — predictable, not random.
    return idx === -1 ? priority.length : idx;
}

// --- Account helpers (used by scrapers before calling ingestEvents) -----------

export interface FindOrCreateAccountInput {
    /** Provider-specific stable ID (FB page id, Luma calendar/user api_id, etc). */
    account_id: string;
    name: string;
    /** Source platform — 'facebook' | 'luma' | 'meetup' | ... */
    type: string;
    /** Platform-presence kind — 'fb_page' | 'luma_calendar' | 'luma_user' | ... */
    kind: string;
    primary_photo?: string | null;
    account_details?: Record<string, unknown> | null;
}

/**
 * Idempotent: returns the existing account if one with the same account_id
 * exists, otherwise inserts a new one. Scrapers call this for every host they
 * see so the accounts table grows organically; admin can group accounts under
 * organizations later via the admin UI.
 *
 * For Facebook specifically, also dedupes by name (case-insensitive) before
 * creating a new row — FB returns different IDs for the same community page
 * depending on context (internal page-id from the Graph API vs public-facing
 * user-style id from the npm scraper's HTML scrape). Same logical org, two
 * IDs. Without name-dedup we'd end up with parallel "PizzaPy" accounts every
 * time a cohost scrape ran. Name-dedup is FB-only because for stable-id
 * platforms (Luma, Meetup) the same name across different api_ids is more
 * likely two genuinely different entities.
 */
export async function findOrCreateAccount(input: FindOrCreateAccountInput): Promise<Account | null> {
    // 1. Exact match by platform ID (the canonical happy path).
    const { data: existing, error: selectErr } = await supabase
        .from('accounts')
        .select('*')
        .eq('account_id', input.account_id)
        .maybeSingle();

    if (selectErr) {
        console.warn(`[ingest] findOrCreateAccount select error for ${input.account_id}:`, selectErr.message);
        return null;
    }
    if (existing) return existing as Account;

    // 2. Facebook-only: dedupe by name to merge the public-vs-internal-id case.
    if (input.type === 'facebook' && input.name) {
        const { data: byName } = await supabase
            .from('accounts')
            .select('*')
            .eq('type', 'facebook')
            .ilike('name', input.name)
            .limit(1)
            .maybeSingle();
        if (byName) {
            console.log(
                `[ingest] reusing existing FB account "${input.name}" (${(byName as Account).account_id}) ` +
                    `instead of creating ${input.account_id}`,
            );
            return byName as Account;
        }
    }

    // 3. Genuinely new — insert.
    const { data: created, error: insertErr } = await supabase
        .from('accounts')
        .insert({
            account_id: input.account_id,
            name: input.name,
            type: input.type,
            kind: input.kind,
            primary_photo: input.primary_photo ?? null,
            account_details: input.account_details ?? null,
            is_active: true,
        })
        .select()
        .single();

    if (insertErr) {
        console.warn(`[ingest] findOrCreateAccount insert error for ${input.account_id}:`, insertErr.message);
        return null;
    }
    return created as Account;
}

// --- Effective priority lookup -------------------------------------------------

/**
 * For an event, find the source_priority of its primary organizer's
 * organization, falling back to DEFAULT_SOURCE_PRIORITY when nothing is set.
 * Three small queries — could be one SQL function later if it becomes hot.
 */
async function getEffectivePriority(eventId: number): Promise<string[]> {
    const { data: organizers } = await supabase
        .from('event_organizers')
        .select('account_id')
        .eq('event_id', eventId)
        .order('position', { ascending: true })
        .limit(1);

    const primaryAccountId = organizers?.[0]?.account_id;
    if (!primaryAccountId) return DEFAULT_SOURCE_PRIORITY;

    const { data: account } = await supabase
        .from('accounts')
        .select('organization_id')
        .eq('account_id', primaryAccountId)
        .maybeSingle();

    const orgId = (account as { organization_id: number | null } | null)?.organization_id;
    if (!orgId) return DEFAULT_SOURCE_PRIORITY;

    const { data: org } = await supabase
        .from('organizations')
        .select('source_priority')
        .eq('id', orgId)
        .maybeSingle();

    const priority = (org as { source_priority: string[] | null } | null)?.source_priority;
    return priority && priority.length > 0 ? priority : DEFAULT_SOURCE_PRIORITY;
}

/**
 * Decide whether the incoming scrape's source should overwrite the event's
 * canonical content. Rules:
 *   - No current primary set → yes
 *   - Same source as current primary → yes (latest-wins within source)
 *   - Different source, higher priority than current → yes
 *   - Different source, equal or lower priority → no
 */
async function shouldBecomeCanonical(eventId: number, candidateSource: string): Promise<boolean> {
    const { data: event } = await supabase
        .from('events')
        .select('primary_source_link_id')
        .eq('id', eventId)
        .maybeSingle();

    const primaryLinkId = (event as { primary_source_link_id: number | null } | null)?.primary_source_link_id;
    if (!primaryLinkId) return true;

    const { data: currentLink } = await supabase
        .from('event_source_links')
        .select('source')
        .eq('id', primaryLinkId)
        .maybeSingle();

    const currentSource = (currentLink as { source: string } | null)?.source;
    if (!currentSource) return true;
    if (currentSource === candidateSource) return true;

    const priority = await getEffectivePriority(eventId);
    return rankOf(candidateSource, priority) < rankOf(currentSource, priority);
}

// --- Mutation helpers ----------------------------------------------------------

async function upsertOrganizers(
    eventId: number,
    organizers: IngestEvent['organizers'],
): Promise<void> {
    if (organizers.length === 0) return;
    const rows = organizers.map((org, i) => ({
        event_id: eventId,
        account_id: org.account_id,
        role: org.role ?? 'host',
        position: i,
    }));
    const { error } = await supabase
        .from('event_organizers')
        .upsert(rows, { onConflict: 'event_id,account_id' });
    if (error) {
        console.warn(`[ingest] upsertOrganizers error for event ${eventId}:`, error.message);
    }
}

async function updateCanonicalContent(
    eventId: number,
    input: IngestEvent,
    sourceLinkId: number,
): Promise<void> {
    const update: EventUpdate = {
        name: input.name,
        description: input.description,
        start_time: input.start_time,
        end_time: input.end_time,
        location: input.location,
        location_details: input.location_details,
        cover_photo: input.cover_photo,
        primary_source_link_id: sourceLinkId,
        // v2 enrichment fields — only overwrite when the new scrape actually
        // provides them (don't clobber existing values with nulls from a
        // less-rich source).
        ...(input.timezone != null && { timezone: input.timezone }),
        ...(input.format != null    && { format: input.format }),
        ...(input.city != null      && { city: input.city }),
        ...(input.region != null    && { region: input.region }),
        ...(input.country != null   && { country: input.country }),
    } as EventUpdate;
    const { error } = await supabase.from('events').update(update).eq('id', eventId);
    if (error) {
        console.warn(`[ingest] updateCanonicalContent error for event ${eventId}:`, error.message);
    }
}

// --- Three ingest branches -----------------------------------------------------

async function handleRescrape(input: IngestEvent, existingLink: { id: number; event_id: number }): Promise<IngestResult> {
    const { error: linkUpdateErr } = await supabase
        .from('event_source_links')
        .update({
            scraped_at: new Date().toISOString(),
            raw: (input.raw ?? null) as never,
            url: input.source_url,
            // Refresh ingest_kind — a partnership scrape replacing a public
            // scrape upgrades the trust tier. Only write if caller provided.
            ...(input.ingest_kind && { ingest_kind: input.ingest_kind }),
        })
        .eq('id', existingLink.id);
    if (linkUpdateErr) {
        console.warn(`[ingest] rescrape link update error:`, linkUpdateErr.message);
    }

    await upsertOrganizers(existingLink.event_id, input.organizers);

    const becameCanonical = await shouldBecomeCanonical(existingLink.event_id, input.source);
    if (becameCanonical) {
        await updateCanonicalContent(existingLink.event_id, input, existingLink.id);
    }

    return {
        event_id: existingLink.event_id,
        is_new_event: false,
        source_link_id: existingLink.id,
        became_canonical: becameCanonical,
        match_score: null,
    };
}

async function attachToMatched(
    input: IngestEvent,
    matchedEventId: number,
    matchScore: number,
): Promise<IngestResult> {
    const { data: link, error: linkErr } = await supabase
        .from('event_source_links')
        .insert({
            event_id: matchedEventId,
            source: input.source,
            source_id: input.source_id,
            url: input.source_url,
            scraped_at: new Date().toISOString(),
            raw: (input.raw ?? null) as never,
            ingest_kind: input.ingest_kind ?? 'public_scrape',
        })
        .select()
        .single();
    if (linkErr || !link) {
        throw new Error(`[ingest] attachToMatched link insert failed: ${linkErr?.message ?? 'unknown'}`);
    }

    await upsertOrganizers(matchedEventId, input.organizers);

    const becameCanonical = await shouldBecomeCanonical(matchedEventId, input.source);
    if (becameCanonical) {
        await updateCanonicalContent(matchedEventId, input, link.id as number);
    }

    return {
        event_id: matchedEventId,
        is_new_event: false,
        source_link_id: link.id as number,
        became_canonical: becameCanonical,
        match_score: matchScore,
    };
}

async function createNewEvent(input: IngestEvent): Promise<IngestResult> {
    const { data: event, error: eventErr } = await supabase
        .from('events')
        .insert({
            name: input.name,
            description: input.description,
            start_time: input.start_time,
            end_time: input.end_time,
            location: input.location,
            location_details: input.location_details,
            cover_photo: input.cover_photo,
            timezone: input.timezone ?? null,
            format: input.format ?? 'in_person',
            city: input.city ?? null,
            region: input.region ?? null,
            country: input.country ?? null,
        })
        .select()
        .single();
    if (eventErr || !event) {
        throw new Error(`[ingest] createNewEvent insert failed: ${eventErr?.message ?? 'unknown'}`);
    }
    const eventId = event.id as number;

    const { data: link, error: linkErr } = await supabase
        .from('event_source_links')
        .insert({
            event_id: eventId,
            source: input.source,
            source_id: input.source_id,
            url: input.source_url,
            scraped_at: new Date().toISOString(),
            raw: (input.raw ?? null) as never,
            ingest_kind: input.ingest_kind ?? 'public_scrape',
        })
        .select()
        .single();
    if (linkErr || !link) {
        throw new Error(`[ingest] createNewEvent link insert failed: ${linkErr?.message ?? 'unknown'}`);
    }
    const linkId = link.id as number;

    await supabase.from('events').update({ primary_source_link_id: linkId }).eq('id', eventId);
    await upsertOrganizers(eventId, input.organizers);

    // Slug generation preserved from the previous saveEvents flow so links keep
    // working. Slug is set once at create time; subsequent canonical updates
    // don't regenerate it (URL stability > URL freshness for a directory).
    const slug = generateEventSlug(event as Event);
    await Promise.allSettled([
        supabase.from('event_slugs').upsert({ slug, event_id: eventId } as EventSlugInsert, { onConflict: 'slug' }),
        supabase.from('events').update({ slug }).eq('id', eventId),
    ]);

    return {
        event_id: eventId,
        is_new_event: true,
        source_link_id: linkId,
        became_canonical: true,
        match_score: null,
    };
}

// --- Public entrypoint ---------------------------------------------------------

interface MatcherRow {
    id: number;
    name: string;
    score: number;
}

/**
 * Ingest a batch of scraped events. For each one:
 *   1. If we've seen this exact (source, source_id) before → re-scrape branch
 *   2. Else if a similar event exists (same date ±1d, name similarity ≥ 0.7)
 *      → attach as new source-link to that event
 *   3. Else → create a new event row
 *
 * Always idempotent: re-running with the same inputs is safe.
 */
export async function ingestEvents(events: IngestEvent[]): Promise<IngestResult[]> {
    const results: IngestResult[] = [];
    for (const input of events) {
        try {
            results.push(await ingestOne(input));
        } catch (err) {
            console.error(
                `[ingest] failed for ${input.source}:${input.source_id} "${input.name}":`,
                err instanceof Error ? err.message : err,
            );
        }
    }
    return results;
}

async function ingestOne(input: IngestEvent): Promise<IngestResult> {
    // Branch 1: this exact source-link already exists → re-scrape
    const { data: existingLink } = await supabase
        .from('event_source_links')
        .select('id, event_id')
        .eq('source', input.source)
        .eq('source_id', input.source_id)
        .maybeSingle();

    if (existingLink) {
        return await handleRescrape(input, existingLink as { id: number; event_id: number });
    }

    // Branch 2: matcher finds a similar event → attach as new source-link
    const { data: matchData, error: matchErr } = await supabase.rpc('find_event_matches', {
        p_name: input.name,
        p_start_time: input.start_time,
        p_threshold: 0.7,
        p_window_days: 1,
    });
    if (matchErr) {
        console.warn(`[ingest] matcher RPC error (proceeding as new event):`, matchErr.message);
    }
    const matches = (matchData ?? []) as MatcherRow[];
    if (matches.length > 0) {
        const top = matches[0];
        console.log(
            `[ingest] match: "${input.name}" → existing event ${top.id} ("${top.name}") score=${top.score.toFixed(2)}`,
        );
        return await attachToMatched(input, top.id, top.score);
    }

    // Branch 3: no match → create new
    return await createNewEvent(input);
}

// --- Bulk fetch helper (for post-ingest enrichment) ---------------------------

/** Fetch event rows by id — convenience for callers that need to pass events
 *  to storeCoverImages / geocodeEventLocations after ingestEvents. */
export async function getEventsByIds(ids: number[]): Promise<Event[]> {
    if (ids.length === 0) return [];
    const { data, error } = await supabase
        .from('events')
        .select('*')
        .in('id', ids);
    if (error) {
        console.warn('[ingest] getEventsByIds error:', error.message);
        return [];
    }
    return (data ?? []) as Event[];
}

// --- Existing helpers preserved (called by scrapers post-ingest) --------------

/**
 * Geocode `location` for events missing `location_details`. Fire-and-forget
 * pattern — call after ingest so newly created events get coordinates
 * automatically. Idempotent: skips events that already have coords or whose
 * location is an online marker.
 */
export const geocodeEventLocations = async (events: Event[]): Promise<void> => {
    const key = Deno.env.get('GOOGLE_MAPS_KEY') ?? Deno.env.get('PUBLIC_GOOGLE_MAPS_KEY');
    if (!key) {
        console.warn('[geocode] GOOGLE_MAPS_KEY not set — skipping geocoding');
        return;
    }

    const todo = events.filter(
        (e) => e.location && !e.location_details && !looksLikeOnlineEvent(e.location),
    );
    if (todo.length === 0) return;

    console.log(`[geocode] processing ${todo.length} event${todo.length === 1 ? '' : 's'}`);

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const event of todo) {
        const result = await geocodeLocation(event.location!, key);
        if (!result.ok) {
            console.warn(`[geocode] id=${event.id} ${result.reason} ← ${event.location}`);
            await sleep(125);
            continue;
        }
        const { error } = await supabase
            .from('events')
            .update({ location_details: { latitude: result.lat, longitude: result.lng } })
            .eq('id', event.id);
        if (error) {
            console.warn(`[geocode] id=${event.id} write failed: ${error.message}`);
        } else {
            console.log(`[geocode] id=${event.id} ✓ ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`);
        }
        await sleep(125);
    }
};

// --- Cover image hosting (R2) -------------------------------------------------
//
// All event covers live in Cloudflare R2 (free egress, fast global delivery).
// The migration script seeded R2 with v1 covers; storeCoverImages keeps it
// populated for new events. If R2 env vars are missing (e.g. local dev without
// secrets), the function gracefully no-ops — events keep their source-CDN URL.
//
// Required env (Edge Function secrets in production):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL

let _r2Client: S3Client | null = null;
function getR2(): { client: S3Client; bucket: string; publicUrl: string } | null {
    const accountId        = Deno.env.get('R2_ACCOUNT_ID');
    const accessKeyId      = Deno.env.get('R2_ACCESS_KEY_ID');
    const secretAccessKey  = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const bucket           = Deno.env.get('R2_BUCKET');
    const publicUrl        = Deno.env.get('R2_PUBLIC_URL');
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
        return null;
    }
    _r2Client ??= new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
    });
    return { client: _r2Client, bucket, publicUrl: publicUrl.replace(/\/+$/, '') };
}

// Browser-ish UA — some CDNs (notably FB) reject default fetch UAs even on
// public images. Doesn't fix expired-token URLs but recovers UA-filter cases.
const COVER_FETCH_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
};

function extFromContentType(ct: string): string {
    const m = ct.match(/image\/([a-z0-9]+)/i);
    if (!m) return 'jpg';
    const e = m[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e;
}

/** Re-host event cover photos to R2 and update events.cover_photo. Idempotent. */
export const storeCoverImages = async (events: EventUpdate[]) => {
    const r2 = getR2();
    if (!r2) {
        console.warn('[cover] R2 env not configured — skipping cover image re-host');
        return { data: [], error: null, processedImages: 0, totalImages: events.length };
    }

    const updates = await Promise.all(
        events.map(async (event) => {
            try {
                if (!event.cover_photo || !event.id) return null;
                // Skip if already on our R2 — re-uploading the same key is
                // cheap, but avoids a fetch round-trip for already-hosted covers.
                if (event.cover_photo.startsWith(r2.publicUrl)) return null;

                const response = await fetch(event.cover_photo, { headers: COVER_FETCH_HEADERS, redirect: 'follow' });
                if (!response.ok) {
                    console.warn(`[cover] fetch ${event.cover_photo} -> HTTP ${response.status} (event ${event.id})`);
                    return null;
                }
                // Validate that the response is actually an image. FB / lumacdn
                // sometimes return 200 with an HTML "content unavailable" page
                // for restricted/deleted events. Without this check we'd upload
                // HTML bytes as a .jpg → broken image in the browser.
                const contentType = response.headers.get('content-type') ?? '';
                if (!contentType.toLowerCase().startsWith('image/')) {
                    console.warn(`[cover] non-image content-type "${contentType}" from ${event.cover_photo} (event ${event.id}) — skipping`);
                    return null;
                }
                const bytes = new Uint8Array(await response.arrayBuffer());

                const slug = event.slug ?? `event-${event.id}`;
                const key = `events/${slug}.${extFromContentType(contentType)}`;

                await r2.client.send(new PutObjectCommand({
                    Bucket: r2.bucket,
                    Key: key,
                    Body: bytes,
                    ContentType: contentType,
                    CacheControl: 'public, max-age=31536000, immutable',
                }));

                return { id: event.id, cover_photo: `${r2.publicUrl}/${key}` };
            } catch (err) {
                console.error(`[cover] error for event ${event.id}:`, err instanceof Error ? err.message : err);
                return null;
            }
        }),
    );

    const filtered = updates.filter((u): u is { id: number; cover_photo: string } => u !== null);
    if (filtered.length === 0) {
        return { data: [], error: null, processedImages: 0, totalImages: events.length };
    }

    // UPDATE instead of UPSERT: rows exist (we just read them); upsert with a
    // partial payload trips NOT NULL on insert-side validation even when the
    // conflict path would never insert. Run updates in parallel.
    const results = await Promise.all(
        filtered.map((row) =>
            supabase.from('events').update({ cover_photo: row.cover_photo }).eq('id', row.id),
        ),
    );
    const errors = results.filter((r) => r.error).map((r) => r.error!);
    if (errors.length > 0) {
        console.error(`[cover] ${errors.length}/${filtered.length} update errors. First:`, errors[0].message);
    }

    return {
        data: filtered,
        error: errors.length > 0 ? errors[0] : null,
        processedImages: filtered.length - errors.length,
        totalImages: events.length,
    };
};
