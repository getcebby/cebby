// Which organizer a sync request may run for. The request body is only a hint:
// the gateway accepts any valid JWT (the public anon key included), so the
// account's type, whether it's watched, and its Cebu-based flag come from the
// database, never from the caller.

export interface AccountRow {
    account_id: string;
    type: string;
    is_active: boolean;
    is_cebu_based: boolean;
}

/** The watched Eventbrite organizer with this id, or null when there is none. */
export async function resolveWatchedOrganizer(
    accountId: string,
    lookup: (accountId: string) => Promise<AccountRow | null>,
): Promise<{ account_id: string; is_cebu_based: boolean } | null> {
    const row = await lookup(accountId);
    if (!row || row.type !== 'eventbrite' || !row.is_active) return null;
    return { account_id: row.account_id, is_cebu_based: row.is_cebu_based === true };
}
