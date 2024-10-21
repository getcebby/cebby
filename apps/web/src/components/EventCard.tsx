import React from "react";
import Link from "next/link";
import Image from "next/image";
import { EventFromDB } from "@/types";
import { formatDate } from "@/utils/date";
import { motion } from "framer-motion";
import { placeholder } from "@/utils/shimmer";

interface EventCardProps {
  event: EventFromDB;
  isFeatured?: boolean;
}

export const EventCard: React.FC<EventCardProps> = ({
  event,
  isFeatured = false,
}) => {
  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden"
    >
      <Link href={`/event/${event.id}`}>
        <div className="relative h-48">
          <Image
            src={event.cover_photo || "/placeholder-image.jpg"}
            alt={event.name}
            fill
            className="transition-transform duration-300 ease-in-out transform hover:scale-110"
            placeholder="blur"
            blurDataURL={placeholder}
          />
          {isFeatured && (
            <span className="absolute top-4 left-4 bg-yellow-400 text-black px-3 py-2 rounded-full text-sm font-bold z-10">
              Featured
            </span>
          )}
        </div>
        <div className="p-4">
          <h3 className="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-200 line-clamp-2">
            {event.name}
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            {formatDate(event.start_time)}
          </p>
          <p className="text-gray-500 dark:text-gray-500 text-sm">
            {event.account.name}
          </p>
        </div>
      </Link>
    </motion.div>
  );
};
