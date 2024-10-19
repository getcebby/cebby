/* eslint-disable @typescript-eslint/no-unused-vars */
import Head from "next/head";
import { createClient } from "@/utils/supabase/component";
import React, { useState, useEffect } from "react";
import { AccountsFromDB, EventFromDB } from "./calendar";
import { useRouter } from "next/router";
import { EventList } from "@/components/EventList";
import { EventGrid } from "@/components/EventGrid";
import { EventBentoGrid } from "@/components/EventBentoGrid";
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
  const [view, setView] = useState<"card" | "list" | "bento">("card");

  useEffect(() => {
    setFilteredEvents(
      selectedAccount
        ? events.filter((event) => Number(event.account.id) === selectedAccount)
        : events
    );
  }, [selectedAccount, events]);

  const { upcomingEvents, recentEvents, pastEvents } =
    groupEventsByTime(filteredEvents);

  const description =
    "Discover and explore exciting events in your area with CebEvents. Find upcoming concerts, workshops, and more!";
  const title = "CebEvents - Discover Local Events";
  const url = "https://events.dorelljames.dev";
  const imageUrl = "https://events.dorelljames.dev/og-image.jpg";

  useEffect(() => {
    // Restore scroll position if returning from an event page
    if (router.asPath === router.route) {
      const scrollPosition = sessionStorage.getItem("scrollPosition");
      if (scrollPosition) {
        window.scrollTo(0, parseInt(scrollPosition, 10));
        sessionStorage.removeItem("scrollPosition");
      }
    }

    // Save scroll position before leaving the page
    const handleRouteChange = () => {
      sessionStorage.setItem("scrollPosition", window.scrollY.toString());
    };

    router.events.on("routeChangeStart", handleRouteChange);

    return () => {
      router.events.off("routeChangeStart", handleRouteChange);
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />

        {/* Open Graph / Facebook */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content={url} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={imageUrl} />

        {/* Twitter */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content={url} />
        <meta property="twitter:title" content={title} />
        <meta property="twitter:description" content={description} />
        <meta property="twitter:image" content={imageUrl} />
      </Head>

      <FilterBar
        accounts={accounts}
        selectedAccount={selectedAccount}
        setSelectedAccount={setSelectedAccount}
        view={view}
        setView={setView}
      />
      {view === "card" && (
        <EventGrid
          upcomingEvents={upcomingEvents}
          recentEvents={recentEvents}
          pastEvents={pastEvents}
        />
      )}
      {view === "list" && (
        <EventList
          upcomingEvents={upcomingEvents}
          recentEvents={recentEvents}
          pastEvents={pastEvents}
        />
      )}
      {view === "bento" && (
        <EventBentoGrid
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
