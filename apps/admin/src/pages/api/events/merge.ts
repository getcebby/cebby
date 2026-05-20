import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { recordEventAuditLog } from '../../../lib/event-audit';
import {
    compactEventState,
    deriveCanonicalEventUpdate,
    type EventRowForContent,
    type SourceLinkForContent,
} from '../../../lib/event-source-content';

export const prerender = false;

function redirectWith(
    redirect: (path: string, status?: 300 | 301 | 302 | 303 | 304 | 307 | 308) => Response,
    target: string,
    kind: 'success' | 'error',
    message: string,
) {
    const separator = target.includes('?') ? '&' : '?';
    return redirect(`${target}${separator}flash=${kind}&msg=${encodeURIComponent(message)}`, 303);
}

function parseEventId(value: FormDataEntryValue | null): number | null {
    const raw = value?.toString().trim();
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

export const POST: APIRoute = async ({ request, redirect }) => {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return new Response('Invalid form data', { status: 400 });
    }

    const targetEventId = parseEventId(formData.get('target_event_id'));
    const duplicateEventId = parseEventId(formData.get('duplicate_event_id'));
    const returnTo = formData.get('return_to')?.toString().trim() || `/events/${targetEventId ?? ''}`;

    if (!targetEventId || !duplicateEventId) {
        return redirectWith(redirect, returnTo, 'error', 'target_event_id and duplicate_event_id are required');
    }
    if (targetEventId === duplicateEventId) {
        return redirectWith(redirect, returnTo, 'error', 'Pick two different events to merge');
    }

    const { data: events, error: eventsErr } = (await supabase
        .from('events')
        .select('id, name, description, start_time, end_time, timezone, location, location_details, cover_photo, city, region, country, primary_source_link_id')
        .in('id', [targetEventId, duplicateEventId])) as unknown as {
        data: EventRowForContent[] | null;
        error: { message: string } | null;
    };

    if (eventsErr) return redirectWith(redirect, returnTo, 'error', eventsErr.message);
    const rows = events ?? [];
    const target = rows.find((row) => row.id === targetEventId);
    const duplicate = rows.find((row) => row.id === duplicateEventId);
    if (!target || !duplicate) {
        return redirectWith(redirect, returnTo, 'error', 'One of the selected events no longer exists');
    }

    const [{ data: duplicateLinks, error: duplicateLinksErr }, { data: duplicateOrganizers, error: organizersErr }] =
        await Promise.all([
            supabase
                .from('event_source_links')
                .select('id, event_id, source, source_id, url, ingest_kind, scraped_at, raw')
                .eq('event_id', duplicateEventId),
            supabase
                .from('event_organizers')
                .select('account_id, role, position')
                .eq('event_id', duplicateEventId)
                .order('position', { ascending: true }),
        ]);

    if (duplicateLinksErr) return redirectWith(redirect, returnTo, 'error', duplicateLinksErr.message);
    if (organizersErr) return redirectWith(redirect, returnTo, 'error', organizersErr.message);

    const organizerRows = (duplicateOrganizers ?? []) as Array<{ account_id: string; role: string; position: number }>;
    if (organizerRows.length > 0) {
        const { data: targetOrganizers, error: targetOrganizersErr } = await supabase
            .from('event_organizers')
            .select('account_id, position')
            .eq('event_id', targetEventId);
        if (targetOrganizersErr) return redirectWith(redirect, returnTo, 'error', targetOrganizersErr.message);

        const existing = new Set(((targetOrganizers ?? []) as Array<{ account_id: string }>).map((row) => row.account_id));
        const maxPosition = Math.max(
            -1,
            ...((targetOrganizers ?? []) as Array<{ position: number | null }>).map((row) => row.position ?? 0),
        );
        const rowsToInsert = organizerRows
            .filter((row) => !existing.has(row.account_id))
            .map((row, index) => ({
                event_id: targetEventId,
                account_id: row.account_id,
                role: row.role ?? 'host',
                position: maxPosition + index + 1,
            }));

        if (rowsToInsert.length > 0) {
            const { error } = await supabase
                .from('event_organizers')
                .upsert(rowsToInsert, { onConflict: 'event_id,account_id' });
            if (error) return redirectWith(redirect, returnTo, 'error', error.message);
        }
    }

    const { error: registrationsErr } = await supabase
        .from('event_registrations')
        .update({ event_id: targetEventId })
        .eq('event_id', duplicateEventId);
    if (registrationsErr) {
        return redirectWith(
            redirect,
            returnTo,
            'error',
            `Registration reassignment failed: ${registrationsErr.message}`,
        );
    }

    const links = (duplicateLinks ?? []) as SourceLinkForContent[];
    if (links.length > 0) {
        const { error } = await supabase
            .from('event_source_links')
            .update({ event_id: targetEventId })
            .eq('event_id', duplicateEventId);
        if (error) return redirectWith(redirect, returnTo, 'error', error.message);
    }

    let fallbackPrimary: number | null = null;
    if (!target.primary_source_link_id) {
        fallbackPrimary =
            links.find((link) => link.id === duplicate.primary_source_link_id)?.id ?? links[0]?.id ?? null;
        if (fallbackPrimary) {
            const fallbackLink = links.find((link) => link.id === fallbackPrimary);
            const update = fallbackLink
                ? deriveCanonicalEventUpdate({ ...fallbackLink, event_id: targetEventId }, target)
                : { primary_source_link_id: fallbackPrimary };
            const { error } = await supabase
                .from('events')
                .update(update)
                .eq('id', targetEventId);
            if (error) return redirectWith(redirect, returnTo, 'error', error.message);
        }
    }

    const { error: slugsErr } = await supabase
        .from('event_slugs')
        .update({ event_id: targetEventId, is_current: false })
        .eq('event_id', duplicateEventId);
    if (slugsErr) return redirectWith(redirect, returnTo, 'error', slugsErr.message);

    const { error: deleteErr } = await supabase
        .from('events')
        .delete()
        .eq('id', duplicateEventId);
    if (deleteErr) return redirectWith(redirect, returnTo, 'error', deleteErr.message);

    const [{ count: targetSourceCount }, { count: targetOrganizerCount }] = await Promise.all([
        supabase
            .from('event_source_links')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', targetEventId),
        supabase
            .from('event_organizers')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', targetEventId),
    ]);

    await recordEventAuditLog({
        eventId: targetEventId,
        action: 'event_merged',
        summary: `Merged event #${duplicateEventId} into event #${targetEventId}`,
        before: {
            target: {
                id: target.id,
                primary_source_link_id: target.primary_source_link_id ?? null,
                event: compactEventState(target),
            },
            duplicate: {
                id: duplicate.id,
                primary_source_link_id: duplicate.primary_source_link_id ?? null,
                event: compactEventState(duplicate),
            },
        },
        after: {
            target_event_id: targetEventId,
            deleted_duplicate_event_id: duplicateEventId,
            source_links: targetSourceCount ?? null,
            organizers: targetOrganizerCount ?? null,
            primary_source_link_id: fallbackPrimary ?? target.primary_source_link_id ?? null,
        },
        metadata: {
            moved_source_link_ids: links.map((link) => link.id),
            moved_sources: links.map((link) => link.source),
            moved_organizer_account_ids: organizerRows.map((row) => row.account_id),
        },
    });

    const movedSources = links.map((link) => link.source).join(', ') || 'no source links';
    return redirectWith(
        redirect,
        returnTo === '/' ? '/' : `/events/${targetEventId}`,
        'success',
        `Merged "${duplicate.name ?? `event #${duplicateEventId}`}" into "${target.name ?? `event #${targetEventId}`}" (${movedSources})`,
    );
};
