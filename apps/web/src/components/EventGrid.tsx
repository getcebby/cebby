import React, { useState, useRef, useEffect } from "react";
import { EventCard } from "./EventCard";
import { EventFromDB, AccountsFromDB } from "@/types";
import { motion } from "framer-motion";
import UpButton from "./UpButton";
import { groupEventsByMonth } from "@/utils/eventUtils";
import { format } from "date-fns";
import { TimelineScrubber } from "./TimelineScrubber";

interface EventGridProps {
  upcomingEvents: EventFromDB[];
  recentEvents: EventFromDB[];
  pastEvents: EventFromDB[];
  accounts: AccountsFromDB[];
  selectedAccount: number | null;
  setSelectedAccount: (id: number | null) => void;
  view: "card" | "list" | "bento";
  setView: (view: "card" | "list" | "bento") => void;
}

export const EventGrid = ({
  upcomingEvents,
  recentEvents,
  pastEvents,
}: EventGridProps) => {
  const groupedEvents = groupEventsByMonth([
    ...upcomingEvents,
    ...recentEvents,
    ...pastEvents,
  ]);
  const [activeSection, setActiveSection] = useState<string>("");
  const [showMobileScrubber, setShowMobileScrubber] = useState(false);
  const sectionRefs = useRef<{ [key: string]: HTMLElement | null }>({});

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 200;
      requestAnimationFrame(() => {
        Object.entries(sectionRefs.current).forEach(([key, ref]) => {
          if (ref) {
            const { offsetTop, offsetHeight } = ref;
            if (
              scrollPosition >= offsetTop &&
              scrollPosition < offsetTop + offsetHeight
            ) {
              setActiveSection(key);
            }
          }
        });
      });
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (sectionKey: string) => {
    const section = sectionRefs.current[sectionKey];
    if (section) {
      const offset = 100;
      window.scrollTo({
        top: section.offsetTop - offset,
        behavior: "smooth",
      });
    }
  };

  // Group events by year
  const eventsByYear = Object.entries(groupedEvents).reduce(
    (acc, [yearMonth]) => {
      const [year] = yearMonth.split("-");
      if (!acc[year]) {
        acc[year] = [];
      }
      acc[year].push(yearMonth);
      return acc;
    },
    {} as { [year: string]: string[] }
  );

  // Sort years in descending order
  const sortedYears = Object.keys(eventsByYear).sort(
    (a, b) => Number(b) - Number(a)
  );

  return (
    <div className="relative">
      {/* Main content */}
      <div className="container mx-auto px-4 py-8 pr-4 md:pr-20">
        <div className="space-y-16">
          {Object.entries(groupedEvents).map(([yearMonth, events]) => {
            const [year, month] = yearMonth.split("-");
            const monthLabel = format(
              new Date(parseInt(year), parseInt(month) - 1),
              "MMMM yyyy"
            );

            return (
              <section
                key={yearMonth}
                ref={(el) => {
                  sectionRefs.current[yearMonth] = el;
                }}
                id={`section-${yearMonth}`}
                className="space-y-6"
              >
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
                  {monthLabel}
                </h2>
                <motion.div
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  {events.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </motion.div>
              </section>
            );
          })}
        </div>
      </div>

      <TimelineScrubber
        sortedYears={sortedYears}
        eventsByYear={eventsByYear}
        activeSection={activeSection}
        showMobileScrubber={showMobileScrubber}
        setShowMobileScrubber={setShowMobileScrubber}
        scrollToSection={scrollToSection}
      />

      <UpButton />
    </div>
  );
};
