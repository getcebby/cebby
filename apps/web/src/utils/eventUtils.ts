import { EventFromDB } from "@/types";

export function groupEventsByTime(events: EventFromDB[]) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const upcomingEvents = events
    .filter((event) => new Date(event.start_time) > now)
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

  const recentEvents = events.filter(
    (event) =>
      new Date(event.start_time) >= startOfMonth &&
      new Date(event.start_time) <= now
  );

  const pastEvents = events.filter(
    (event) => new Date(event.start_time) < startOfMonth
  );

  return { upcomingEvents, recentEvents, pastEvents };
}
