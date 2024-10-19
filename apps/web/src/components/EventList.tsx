import React from "react";
import { EventFromDB } from "../pages/calendar";
import { EventSection } from "./EventSection";

export function EventList({
  upcomingEvents,
  recentEvents,
  pastEvents,
}: {
  upcomingEvents: EventFromDB[];
  recentEvents: EventFromDB[];
  pastEvents: EventFromDB[];
}) {
  return (
    <>
      <EventSection
        events={upcomingEvents}
        title="Upcoming Events"
        description="Happening pretty soon..."
        viewType="list"
      />
      <EventSection
        events={recentEvents}
        title="Recent Events"
        description="Events you might have missed this month..."
        viewType="list"
      />
      <EventSection
        events={pastEvents}
        title="Past Events"
        description="Events that happened in the past..."
        viewType="list"
      />
    </>
  );
}
