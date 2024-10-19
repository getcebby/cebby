import React from "react";
import { EventFromDB } from "../pages/calendar";
import { EventBentoItem } from "./EventBentoItem";

export function EventBentoGrid({
  upcomingEvents,
  recentEvents,
  pastEvents,
}: {
  upcomingEvents: EventFromDB[];
  recentEvents: EventFromDB[];
  pastEvents: EventFromDB[];
}) {
  const allEvents = [...upcomingEvents, ...recentEvents, ...pastEvents];

  return (
    <div className="py-12 px-4 sm:px-6 lg:px-8 bg-gray-100 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {allEvents.map((event, index) => (
            <EventBentoItem key={event.id} event={event} index={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
