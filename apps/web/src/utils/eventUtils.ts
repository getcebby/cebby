import { EventFromDB } from "@/types";

export function groupEventsByTime(events: EventFromDB[], selectedMonth: string, selectedYear: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Filter events based on selected month and year
  const customFilter = (event: EventFromDB) => {
    const eventDate = new Date(event.start_time);
    const eventMonth = eventDate.toLocaleString('default', { month: 'long' });
    const eventYear = eventDate.getFullYear().toString();

    const isMonthMatch = selectedMonth === "All Months" || eventMonth === selectedMonth;
    const isYearMatch = selectedYear === "All Years" || eventYear === selectedYear;

    return isMonthMatch && isYearMatch;
  };

  const upcomingEvents = events
    .filter((event) => new Date(event.start_time) > now && customFilter(event))
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

  const recentEvents = events
    .filter((event) => 
      new Date(event.start_time) >= startOfMonth &&
      new Date(event.start_time) <= now &&
      customFilter(event)
    );

  const pastEvents = events
    .filter((event) => 
      new Date(event.start_time) < startOfMonth &&
      customFilter(event)
    );

  return { upcomingEvents, recentEvents, pastEvents };
}
