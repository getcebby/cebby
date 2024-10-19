import React from "react";
import { EventFromDB } from "../pages/calendar";
import { EventCard } from "./EventCard";
import { EventListItem } from "./EventListItem";

export function EventSection({
  events,
  title,
  description,
  viewType,
}: {
  events: EventFromDB[];
  title: string;
  description: string;
  viewType: "card" | "list";
}) {
  return (
    <div className="py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
          {title}
        </h2>
        <p className="mt-3 max-w-2xl text-xl text-gray-500 sm:mt-4">
          {description}
        </p>
        {viewType === "card" ? (
          <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </ul>
        ) : (
          <ul className="mt-12 space-y-4">
            {events.map((event) => (
              <EventListItem key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
