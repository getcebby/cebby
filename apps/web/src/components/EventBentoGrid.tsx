import React from "react";
import { EventFromDB, AccountsFromDB } from "@/types";
import { EventBentoItem } from "./EventBentoItem";
import UpButton from "./UpButton";

interface EventBentoGridProps {
  upcomingEvents: EventFromDB[];
  recentEvents: EventFromDB[];
  pastEvents: EventFromDB[];
  accounts: AccountsFromDB[];
  selectedAccount: number | null;
  setSelectedAccount: (id: number | null) => void;
  view: "card" | "list" | "bento";
  setView: (view: "card" | "list" | "bento") => void;
}

export function EventBentoGrid({
  upcomingEvents,
  recentEvents,
  pastEvents,
}: EventBentoGridProps) {
  const allEvents = [...upcomingEvents, ...recentEvents, ...pastEvents];
  const isEmpty = allEvents.length === 0;

  return (
    <div className="container mx-auto px-4 py-8">
      {isEmpty ? (
        <div className="text-center text-4xl mt-32 font-bold font-mono text-gray-500">
          Oops... Not Available
        </div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {upcomingEvents.map((event, index) => (
              <div
                key={event.id}
                className={`${index === 0 ? "sm:col-span-2 sm:row-span-2" : ""}`}
              >
                <EventBentoItem event={event} isFeatured={true} />
              </div>
            ))}
            {recentEvents.map((event) => (
              <div key={event.id}>
                <EventBentoItem event={event} isFeatured={false} />
              </div>
            ))}
            {pastEvents.map((event) => (
              <div key={event.id}>
                <EventBentoItem event={event} isFeatured={false} />
              </div>
            ))}
          </div>
        </>
      )}
      <UpButton />
    </div>
  );
}
