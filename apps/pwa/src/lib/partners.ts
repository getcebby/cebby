import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@service/core/supabase/shared/database.types.ts";

interface PartnerAccountRow {
  account_id: string;
  name: string;
  primary_photo: string | null;
  type: string | null;
  kind: string | null;
  discovery_path: string | null;
  created_at: string | null;
  is_verified: boolean | null;
  ingest_kind: string | null;
}

interface OrganizerCountRow {
  account_id: string;
  event_id: number;
}

export interface PartnerCard {
  key: string;
  account_id: string;
  name: string;
  primary_photo: string | null;
  href: string;
  event_count: number;
  /** True when at least one grouped account is a token-backed partnership
   * (ingest_kind='partnership'). An org with a partnership FB token and
   * a public-scrape Luma calendar still counts — partnership status is
   * additive, not exclusive. */
  is_partner: boolean;
  accounts: PartnerAccountRow[];
}

function partnerKey(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/\s+community$/, "")
    .replace(/\s+/g, " ");

  if (normalized.startsWith("pizzapy")) {
    return "pizzapy";
  }

  return normalized;
}

function partnerHref(account: PartnerAccountRow): string {
  if (account.type === "facebook") {
    return `https://www.facebook.com/${account.account_id}`;
  }
  if (account.type === "meetup") {
    return `https://www.meetup.com/${
      account.discovery_path ?? account.account_id
    }/`;
  }
  return "#";
}

function accountScore(account: PartnerAccountRow, eventCount: number): number {
  return eventCount * 1000 +
    (account.primary_photo ? 100 : 0) +
    (account.type === "facebook" ? 20 : 0) +
    (account.type === "meetup" ? 10 : 0) -
    account.name.length / 100;
}

export async function getPartnerCards(
  supabase: SupabaseClient<Database>,
  options: { limit?: number } = {},
): Promise<
  { partners: PartnerCard[]; totalTrackedEvents: number; error: unknown }
> {
  const { data: accounts, error } = await supabase
    .from("accounts")
    .select(
      "account_id,name,primary_photo,type,kind,discovery_path,created_at,is_verified,ingest_kind",
    )
    .order("name", { ascending: true });

  if (error) {
    return { partners: [], totalTrackedEvents: 0, error };
  }

  const { data: organizerRows } = await supabase
    .from("event_organizers")
    .select("account_id,event_id");

  const eventIdsByAccount = new Map<string, Set<number>>();
  for (const row of (organizerRows ?? []) as OrganizerCountRow[]) {
    if (!row?.account_id || row.event_id == null) continue;
    const ids = eventIdsByAccount.get(row.account_id) ?? new Set<number>();
    ids.add(row.event_id);
    eventIdsByAccount.set(row.account_id, ids);
  }

  const groups = new Map<
    string,
    { accounts: PartnerAccountRow[]; eventIds: Set<number> }
  >();
  for (const account of (accounts ?? []) as PartnerAccountRow[]) {
    const key = partnerKey(account.name);
    const group = groups.get(key) ??
      { accounts: [], eventIds: new Set<number>() };
    group.accounts.push(account);
    for (const eventId of eventIdsByAccount.get(account.account_id) ?? []) {
      group.eventIds.add(eventId);
    }
    groups.set(key, group);
  }

  const partners = [...groups.entries()]
    .filter(([, group]) =>
      group.accounts.some((account) => account.is_verified)
    )
    .map(([key, group]) => {
      const best = group.accounts
        .filter((account) => account.is_verified)
        .slice()
        .sort((a, b) =>
          accountScore(b, eventIdsByAccount.get(b.account_id)?.size ?? 0) -
          accountScore(a, eventIdsByAccount.get(a.account_id)?.size ?? 0)
        )[0];

      return {
        key,
        account_id: best.account_id,
        name: best.name,
        primary_photo: best.primary_photo,
        href: partnerHref(best),
        event_count: group.eventIds.size,
        is_partner: group.accounts.some((a) => a.ingest_kind === "partnership"),
        accounts: group.accounts,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    partners: typeof options.limit === "number"
      ? partners.slice(0, options.limit)
      : partners,
    totalTrackedEvents: new Set(
      (organizerRows ?? []).map((row) => (row as OrganizerCountRow).event_id),
    ).size,
    error: null,
  };
}
