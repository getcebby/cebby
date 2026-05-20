import { supabase } from './supabase';

type Jsonish = Record<string, unknown> | unknown[] | string | number | boolean | null;

export interface EventAuditLogInput {
    eventId: number | null;
    action: string;
    summary: string;
    before?: Jsonish;
    after?: Jsonish;
    metadata?: Jsonish;
    actor?: string;
}

function isMissingAuditTable(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
        normalized.includes('event_audit_logs') ||
        normalized.includes('schema cache') ||
        (normalized.includes('relation') && normalized.includes('does not exist'))
    );
}

export async function recordEventAuditLog(input: EventAuditLogInput): Promise<void> {
    const { error } = await supabase
        .from('event_audit_logs')
        .insert({
            event_id: input.eventId,
            action: input.action,
            summary: input.summary,
            actor: input.actor ?? 'admin',
            before_state: input.before ?? null,
            after_state: input.after ?? null,
            metadata: input.metadata ?? null,
        } as never);

    if (!error) return;
    if (isMissingAuditTable(error.message)) {
        console.warn('[admin/audit] event_audit_logs not available yet; skipped audit write');
        return;
    }
    console.warn('[admin/audit] failed to write event audit log:', error.message);
}
