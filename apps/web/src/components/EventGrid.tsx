import React from "react";
import { EventFromDB } from "../pages/calendar";
import { EventSection } from "./EventSection";
import { EventCard } from "./EventCard";

export function EventGrid({
  upcomingEvents,
  recentEvents,
  pastEvents,
}: {
  upcomingEvents: EventFromDB[];
  recentEvents: EventFromDB[];
  pastEvents: EventFromDB[];
}) {
  const renderEventCard = (event: EventFromDB) => (
    <EventCard key={event.id} event={event} showFacebookButton={true} />
  );

  return (
    <>
      <EventSection
        events={upcomingEvents}
        title="Upcoming Events"
        description="Happening pretty soon..."
        viewType="card"
      />
      <EventSection
        events={recentEvents}
        title="Recent Events"
        description="Events you might have missed this month..."
        viewType="card"
      />
      <EventSection
        events={pastEvents}
        title="Past Events"
        description="Events that happened in the past..."
        viewType="card"
      />
    </>
  );
}
