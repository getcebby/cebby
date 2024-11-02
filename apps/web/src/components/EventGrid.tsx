import React from "react";
import { EventCard } from "./EventCard";
import { EventFromDB, AccountsFromDB } from "@/types";
import { motion } from "framer-motion";
import UpButton from "./UpButton";
import { app } from "@/config/app";

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

const container = {
  hidden: { opacity: 0, scale: 0.8 },
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
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export const EventGrid = ({
  upcomingEvents,
  recentEvents,
  pastEvents,
  ...props
}: EventGridProps) => {
  return (
    <div
      className="container mx-auto px-4 py-8"
      id="event-grid"
      data-view={props.view}
    >
      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">
            Upcoming Events
          </h2>
          {upcomingEvents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {upcomingEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
              <h3 className="text-xl font-bold mb-3 text-gray-800 dark:text-gray-200">
                It&apos;s a bit quiet here, isn&apos;t it?
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Let&apos;s change that! Reach out to{" "}
                <a
                  href="https://m.me/galangdj"
                  className="text-blue-500 underline hover:text-blue-700 transition-colors duration-300"
                >
                  @dorelljames
                </a>{" "}
                to get your events featured on <strong>{app.title}</strong>! 🎉
              </p>
            </div>
          )}
        </section>

        {recentEvents.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">
              Recent Events
            </h2>
            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
              variants={container}
              initial="hidden"
              animate="visible"
            >
              {recentEvents.map((event) => (
                <motion.div key={event.id} variants={item}>
                  <EventCard event={event} />
                </motion.div>
              ))}
            </motion.div>
          </section>
        )}

        {pastEvents.length > 0 && (
          <section>
            <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">
              Past Events
            </h2>
            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
              variants={container}
              initial="hidden"
              animate="visible"
            >
              {pastEvents.map((event) => (
                <motion.div key={event.id} variants={item}>
                  <EventCard event={event} />
                </motion.div>
              ))}
            </motion.div>
          </section>
        )}
      </div>
      <UpButton />
    </div>
  );
};
