import React from "react";
import { EventFromDB } from "../pages/calendar";
import { EventBentoItem } from "./EventBentoItem";

interface EventBentoGridProps {
  upcomingEvents: EventFromDB[];
  recentEvents: EventFromDB[];
  pastEvents: EventFromDB[];
}

export function EventBentoGrid({
  upcomingEvents,
  recentEvents,
  pastEvents,
}: EventBentoGridProps) {
  const allEvents = [...upcomingEvents, ...recentEvents, ...pastEvents];
  const featuredEvents = allEvents.filter((event) => event.is_featured);
  const regularEvents = allEvents.filter((event) => !event.is_featured);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {featuredEvents.map((event, index) => (
          <div
            key={event.id}
            className={`${index === 0 ? "sm:col-span-2 sm:row-span-2" : ""}`}
          >
            <EventBentoItem event={event} isFeatured={true} />
          </div>
        ))}
        {regularEvents.map((event) => (
          <div key={event.id}>
            <EventBentoItem event={event} isFeatured={false} />
          </div>
        ))}
      </div>
    </div>
  );
}
