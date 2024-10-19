/* eslint-disable @typescript-eslint/no-unused-vars */
import { createClient } from "@/utils/supabase/component";
import React, { useState, useEffect } from "react";
import { AccountsFromDB, EventFromDB } from "./calendar";
import { useRouter } from "next/router";
import { EventList } from "@/components/EventList";
import { EventGrid } from "@/components/EventGrid";
import { FilterBar } from "@/components/FilterBar";
import { groupEventsByTime } from "@/utils/eventUtils";

const supabase = createClient();

export default function Home({
  events,
  accounts,
}: {
  events: EventFromDB[];
  accounts: AccountsFromDB[];
}) {
  const router = useRouter();
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [filteredEvents, setFilteredEvents] = useState(events);
  const [view, setView] = useState<"card" | "list">("card");

  useEffect(() => {
    setFilteredEvents(
      selectedAccount
        ? events.filter((event) => Number(event.account.id) === selectedAccount)
        : events
    );
  }, [selectedAccount, events]);

  const { upcomingEvents, recentEvents, pastEvents } =
    groupEventsByTime(filteredEvents);

  return (
    <div>
      <FilterBar
        accounts={accounts}
        selectedAccount={selectedAccount}
        setSelectedAccount={setSelectedAccount}
        view={view}
        setView={setView}
      />
      {view === "card" ? (
        <EventGrid
          upcomingEvents={upcomingEvents}
          recentEvents={recentEvents}
          pastEvents={pastEvents}
        />
      ) : (
        <EventList
          upcomingEvents={upcomingEvents}
          recentEvents={recentEvents}
          pastEvents={pastEvents}
        />
      )}
    </div>
  );
}

export async function getServerSideProps() {
  const { data, error } = await supabase
    .from("events")
    .select(
      `
      *,
      account:account_id (
        id,
        name,
        type
      )
    `
    )
    .order("start_time", { ascending: false });

  if (error) {
    console.error(error);
    return { props: { events: [], accounts: [] } };
  }

  const accounts = Array.from(
    new Map(data?.map((event) => [event.account.id, event.account])).values()
  );

  return { props: { events: data, accounts } };
}
