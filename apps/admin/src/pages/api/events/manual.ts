import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { datetimeLocalToIso, normalizeEventSourceId } from '../../../lib/event-import';
import { slugify } from '../../../lib/slug';

export const prerender = false;

interface EventSourceLink {
    id: number;
    event_id: number;
}

interface MatchRow {
    id: number;
    name: string;
    score: number;
}

function redirectWith(
    redirect: (path: string, status?: 300 | 301 | 302 | 303 | 304 | 307 | 308) => Response,
    target: string,
    kind: 'success' | 'error' | 'info',
    message: string,
) {
    const separator = target.includes('?') ? '&' : '?';
    return redirect(`${target}${separator}flash=${kind}&msg=${encodeURIComponent(message)}`, 303);
}

function value(formData: FormData, key: string): string {
    return formData.get(key)?.toString().trim() ?? '';
}

function nullable(value: string): string | null {
    return value.trim() || null;
}

function parsePositiveInt(raw: string): number | null {
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) || parsed < 1 ? null : parsed;
}

function parseRawJson(rawJson: string, fallback: Record<string, unknown>): Record<string, unknown> {
    if (!rawJson) return fallback;
    try {
        const parsed = JSON.parse(rawJson) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Fall through to a compact audit payload.
    }
    return fallback;
}

function sourceForUrl(sourceUrl: string): 'website' | 'manual' {
    return sourceUrl ? 'website' : 'manual';
}

function isValidHttpUrl(sourceUrl: string): boolean {
    if (!sourceUrl) return true;
    try {
        const parsed = new URL(sourceUrl);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

async function ensureEventSlug(eventId: number, name: string): Promise<string | null> {
    const base = slugify(name) || 'event';
    const slug = `${base}--${eventId}`;

    const { error: staleErr } = await supabase
        .from('event_slugs')
        .update({ is_current: false })
        .eq('event_id', eventId);
    if (staleErr) {
        console.warn(`[admin/manual-event] slug stale update failed for ${eventId}:`, staleErr.message);
    }

    const { error: slugErr } = await supabase
        .from('event_slugs')
        .upsert({ slug, event_id: eventId, is_current: true }, { onConflict: 'slug' });
    if (slugErr) {
        console.warn(`[admin/manual-event] slug upsert failed for ${eventId}:`, slugErr.message);
        return null;
    }

    const { error: eventErr } = await supabase
        .from('events')
        .update({ slug })
        .eq('id', eventId);
    if (eventErr) {
        console.warn(`[admin/manual-event] event slug update failed for ${eventId}:`, eventErr.message);
        return null;
    }
    return slug;
}

async function resolveOrganizer(formData: FormData, sourceUrl: string): Promise<{ accountId: string | null; error?: string }> {
    const existingAccountId = value(formData, 'organizer_account_id');
    if (existingAccountId) return { accountId: existingAccountId };

    const name = value(formData, 'new_organizer_name');
    if (!name) return { accountId: null };

    const { data: byName, error: byNameErr } = await supabase
        .from('accounts')
        .select('account_id')
        .ilike('name', name)
        .limit(1)
        .maybeSingle();
    if (byNameErr) return { accountId: null, error: byNameErr.message };
    if (byName?.account_id) return { accountId: byName.account_id as string };

    const orgId = parsePositiveInt(value(formData, 'new_organizer_organization_id'));
    let discoveryPath: string | null = null;
    if (sourceUrl) {
        try {
            discoveryPath = new URL(sourceUrl).hostname.replace(/^www\./, '');
        } catch {
            discoveryPath = null;
        }
    }

    const root = slugify(name) || 'organizer';
    for (let i = 1; i <= 30; i++) {
        const accountId = i === 1 ? `manual:${root}` : `manual:${root}-${i}`;
        const { data: existing } = await supabase
            .from('accounts')
            .select('account_id')
            .eq('account_id', accountId)
            .maybeSingle();
        if (existing) continue;

        const { error } = await supabase.from('accounts').insert({
            account_id: accountId,
            name,
            type: 'website',
            kind: 'website_organizer',
            discovery_path: discoveryPath,
            ingest_kind: 'manual',
            organization_id: orgId,
            is_active: true,
        });
        if (!error) return { accountId };
        if (error.code !== '23505') return { accountId: null, error: error.message };
    }

    return { accountId: null, error: 'Could not create a unique organizer account' };
}

async function attachOrganizer(eventId: number, accountId: string | null): Promise<string | null> {
    if (!accountId) return null;

    const { data: existingRows, error: existingErr } = await supabase
        .from('event_organizers')
        .select('account_id, position')
        .eq('event_id', eventId);
    if (existingErr) return existingErr.message;

    const existing = (existingRows ?? []) as Array<{ account_id: string; position: number | null }>;
    if (existing.some((row) => row.account_id === accountId)) return null;

    const maxPosition = Math.max(-1, ...existing.map((row) => row.position ?? 0));
    const { error } = await supabase.from('event_organizers').insert({
        event_id: eventId,
        account_id: accountId,
        role: 'host',
        position: maxPosition + 1,
    });
    return error?.message ?? null;
}

async function findAutoMatch(name: string, startTime: string): Promise<number | null> {
    const { data, error } = await supabase.rpc('find_event_matches', {
        p_name: name,
        p_start_time: startTime,
        p_threshold: 0.7,
        p_window_days: 1,
    });
    if (error) {
        console.warn('[admin/manual-event] matcher RPC failed:', error.message);
        return null;
    }
    const matches = (data ?? []) as MatchRow[];
    return matches[0]?.id ?? null;
}

async function insertSourceLink(
    eventId: number,
    source: 'website' | 'manual',
    sourceId: string,
    sourceUrl: string,
    raw: Record<string, unknown>,
): Promise<{ link?: EventSourceLink; error?: string }> {
    const { data, error } = await supabase
        .from('event_source_links')
        .insert({
            event_id: eventId,
            source,
            source_id: sourceId,
            url: nullable(sourceUrl),
            ingest_kind: 'manual',
            scraped_at: new Date().toISOString(),
            raw,
        })
        .select('id, event_id')
        .single();
    if (error || !data) return { error: error?.message ?? 'source link insert failed' };
    return { link: data as EventSourceLink };
}

async function updateSourceLink(
    linkId: number,
    sourceUrl: string,
    raw: Record<string, unknown>,
): Promise<string | null> {
    const { error } = await supabase
        .from('event_source_links')
        .update({
            url: nullable(sourceUrl),
            ingest_kind: 'manual',
            scraped_at: new Date().toISOString(),
            raw,
        })
        .eq('id', linkId);
    return error?.message ?? null;
}

export const POST: APIRoute = async ({ request, redirect }) => {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return redirectWith(redirect, '/events/new', 'error', 'Invalid form data');
    }

    const name = value(formData, 'name');
    const timezone = value(formData, 'timezone') || 'Asia/Manila';
    const startTime = datetimeLocalToIso(value(formData, 'start_time'), timezone);
    const endTime = datetimeLocalToIso(value(formData, 'end_time'), timezone);
    const sourceUrl = normalizeEventSourceId(value(formData, 'source_url'));
    const source = sourceForUrl(sourceUrl);
    const sourceId = value(formData, 'source_id')
        || (sourceUrl ? normalizeEventSourceId(sourceUrl) : `manual:${crypto.randomUUID()}`);
    const status = value(formData, 'status') || 'published';
    const format = value(formData, 'format') || 'in_person';
    const makeCanonical = formData.get('make_canonical')?.toString() === 'true';
    const autoMatch = formData.get('auto_match')?.toString() === 'true';

    if (!name) return redirectWith(redirect, '/events/new', 'error', 'Event name is required');
    if (!startTime) return redirectWith(redirect, '/events/new', 'error', 'Start time is required');
    if (!isValidHttpUrl(sourceUrl)) return redirectWith(redirect, '/events/new', 'error', 'Source URL must be http or https');
    if (endTime && new Date(endTime) < new Date(startTime)) {
        return redirectWith(redirect, '/events/new', 'error', 'End time must be after start time');
    }

    const raw = parseRawJson(value(formData, 'raw_json'), {
        source_url: sourceUrl || null,
        submitted_at: new Date().toISOString(),
        submitted_via: 'admin_manual_event',
    });

    const eventFields = {
        name,
        description: nullable(value(formData, 'description')),
        start_time: startTime,
        end_time: endTime,
        location: nullable(value(formData, 'location')),
        cover_photo: nullable(value(formData, 'cover_photo')),
        timezone,
        format,
        status,
    };

    const { accountId, error: organizerErr } = await resolveOrganizer(formData, sourceUrl);
    if (organizerErr) return redirectWith(redirect, '/events/new', 'error', organizerErr);

    const { data: existingLink } = await supabase
        .from('event_source_links')
        .select('id, event_id')
        .eq('source', source)
        .eq('source_id', sourceId)
        .maybeSingle();

    let eventId = (existingLink as EventSourceLink | null)?.event_id ?? null;
    let sourceLinkId = (existingLink as EventSourceLink | null)?.id ?? null;

    if (!eventId) {
        eventId = parsePositiveInt(value(formData, 'target_event_id'));
    }
    if (!eventId && autoMatch) {
        eventId = await findAutoMatch(name, startTime);
    }

    if (eventId) {
        if (sourceLinkId) {
            const linkErr = await updateSourceLink(sourceLinkId, sourceUrl, raw);
            if (linkErr) return redirectWith(redirect, '/events/new', 'error', linkErr);
        } else {
            const inserted = await insertSourceLink(eventId, source, sourceId, sourceUrl, raw);
            if (inserted.error || !inserted.link) {
                return redirectWith(redirect, '/events/new', 'error', inserted.error ?? 'source link insert failed');
            }
            sourceLinkId = inserted.link.id;
        }

        const orgAttachErr = await attachOrganizer(eventId, accountId);
        if (orgAttachErr) return redirectWith(redirect, `/events/${eventId}`, 'error', orgAttachErr);

        if (makeCanonical && sourceLinkId) {
            const { error } = await supabase
                .from('events')
                .update({ ...eventFields, primary_source_link_id: sourceLinkId })
                .eq('id', eventId);
            if (error) return redirectWith(redirect, `/events/${eventId}`, 'error', error.message);
        }

        return redirectWith(
            redirect,
            `/events/${eventId}`,
            'success',
            existingLink ? 'Updated manual source link' : 'Attached manual source link',
        );
    }

    const { data: created, error: createErr } = await supabase
        .from('events')
        .insert({ ...eventFields, country: 'PH' })
        .select('id')
        .single();
    if (createErr || !created) {
        return redirectWith(redirect, '/events/new', 'error', createErr?.message ?? 'event insert failed');
    }

    eventId = created.id as number;
    const inserted = await insertSourceLink(eventId, source, sourceId, sourceUrl, raw);
    if (inserted.error || !inserted.link) {
        return redirectWith(redirect, `/events/${eventId}`, 'error', inserted.error ?? 'source link insert failed');
    }

    const { error: primaryErr } = await supabase
        .from('events')
        .update({ primary_source_link_id: inserted.link.id })
        .eq('id', eventId);
    if (primaryErr) return redirectWith(redirect, `/events/${eventId}`, 'error', primaryErr.message);

    await ensureEventSlug(eventId, name);

    const orgAttachErr = await attachOrganizer(eventId, accountId);
    if (orgAttachErr) return redirectWith(redirect, `/events/${eventId}`, 'error', orgAttachErr);

    return redirectWith(redirect, `/events/${eventId}`, 'success', 'Created manual event');
};
