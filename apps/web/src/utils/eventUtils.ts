import { EventFromDB } from "@/types";
import {
  formatDistanceToNow,
  isFuture,
  isPast,
  format,
  startOfWeek,
  endOfWeek,
  parseISO,
  getYear,
} from "date-fns";

export function groupEventsByTime(
  events: EventFromDB[],
  selectedMonth: string,
  selectedYear: string
) {
  const now = new Date();
  const filteredEvents = events.filter((event) => {
    const eventDate = parseISO(event.start_time);
    if (selectedMonth !== "All Months") {
      const eventMonth = format(eventDate, "MMMM");
      if (eventMonth !== selectedMonth) return false;
    }
    if (selectedYear !== "All Years") {
      const eventYear = format(eventDate, "yyyy");
      if (eventYear !== selectedYear) return false;
    }
    return true;
  });

  return {
    upcomingEvents: filteredEvents.filter((event) =>
      isFuture(parseISO(event.start_time))
    ),
    recentEvents: filteredEvents.filter(
      (event) =>
        isPast(parseISO(event.start_time)) &&
        parseISO(event.start_time).getTime() >
          now.getTime() - 7 * 24 * 60 * 60 * 1000
    ),
    pastEvents: filteredEvents.filter(
      (event) =>
        isPast(parseISO(event.start_time)) &&
        parseISO(event.start_time).getTime() <=
          now.getTime() - 7 * 24 * 60 * 60 * 1000
    ),
  };
}

export function groupEventsByWeek(events: EventFromDB[]) {
  const groupedEvents: { [year: string]: { [week: string]: EventFromDB[] } } =
    {};

  // First, separate upcoming and past events
  const upcomingEvents = events.filter((event) =>
    isFuture(new Date(event.start_time))
  );
  const pastEvents = events.filter((event) =>
    isPast(new Date(event.start_time))
  );

  // Group upcoming events by relative time under current year
  const currentYear = new Date().getFullYear().toString();
  if (!groupedEvents[currentYear]) {
    groupedEvents[currentYear] = {};
  }

  upcomingEvents.forEach((event) => {
    const eventDate = new Date(event.start_time);
    const relativeTime = formatDistanceToNow(eventDate, { addSuffix: true });

    if (!groupedEvents[currentYear][relativeTime]) {
      groupedEvents[currentYear][relativeTime] = [];
    }
    groupedEvents[currentYear][relativeTime].push(event);
  });

  // Group past events by year and week
  pastEvents.forEach((event) => {
    const eventDate = new Date(event.start_time);
    const year = getYear(eventDate).toString();
    const weekStart = format(startOfWeek(eventDate), "MMM d");
    const weekEnd = format(endOfWeek(eventDate), "MMM d");
    const weekKey = `${weekStart} - ${weekEnd}`;

    if (!groupedEvents[year]) {
      groupedEvents[year] = {};
    }
    if (!groupedEvents[year][weekKey]) {
      groupedEvents[year][weekKey] = [];
    }
    groupedEvents[year][weekKey].push(event);
  });

  return groupedEvents;
}

export function groupEventsByMonth(events: EventFromDB[]) {
  const groupedEvents: { [yearMonth: string]: EventFromDB[] } = {};

  events.forEach((event) => {
    const date = new Date(event.start_time);
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // JavaScript months are 0-based
    const yearMonth = `${year}-${month.toString().padStart(2, "0")}`;

    if (!groupedEvents[yearMonth]) {
      groupedEvents[yearMonth] = [];
    }
    groupedEvents[yearMonth].push(event);
  });

  // Sort by date descending
  return Object.fromEntries(
    Object.entries(groupedEvents).sort(([a], [b]) => b.localeCompare(a))
  );
}
