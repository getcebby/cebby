import React from "react";
import { EventFromDB } from "@/pages/calendar";
import { EventListItem } from "./EventListItem";
import { motion } from "framer-motion";

interface EventListProps {
  upcomingEvents: EventFromDB[];
  recentEvents: EventFromDB[];
  pastEvents: EventFromDB[];
}

export const EventList: React.FC<EventListProps> = ({
  upcomingEvents,
  recentEvents,
  pastEvents,
}) => {
  const container = {
    hidden: { opacity: 1, scale: 0 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        delayChildren: 0.3,
        staggerChildren: 0.2,
      },
    },
  };

  const item = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
    },
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {upcomingEvents.length > 0 && (
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">
            Upcoming Events
          </h2>
          <motion.ul
            className="space-y-4"
            variants={container}
            initial="hidden"
            animate="visible"
          >
            {upcomingEvents.map((event) => (
              <motion.li key={event.id} variants={item}>
                <EventListItem event={event} />
              </motion.li>
            ))}
          </motion.ul>
        </section>
      )}

      {recentEvents.length > 0 && (
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">
            Recent Events
          </h2>
          <motion.ul
            className="space-y-4"
            variants={container}
            initial="hidden"
            animate="visible"
          >
            {recentEvents.map((event) => (
              <motion.li key={event.id} variants={item}>
                <EventListItem event={event} />
              </motion.li>
            ))}
          </motion.ul>
        </section>
      )}

      {pastEvents.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">
            Past Events
          </h2>
          <motion.ul
            className="space-y-4"
            variants={container}
            initial="hidden"
            animate="visible"
          >
            {pastEvents.map((event) => (
              <motion.li key={event.id} variants={item}>
                <EventListItem event={event} />
              </motion.li>
            ))}
          </motion.ul>
        </section>
      )}
    </div>
  );
};
