import React from "react";
import Link from "next/link";
import Image from "next/image";
import { EventFromDB } from "../pages/calendar";
import { formatDate } from "@/utils/date";
import { motion } from "framer-motion";
import { placeholder } from "@/utils/shimmer";

interface EventListItemProps {
  event: EventFromDB;
  isFeatured?: boolean;
}

export const EventListItem: React.FC<EventListItemProps> = ({
  event,
  isFeatured = false,
}) => {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden mb-4"
    >
      <Link href={`/event/${event.id}`}>
        <div className="flex items-center p-4">
          <div className="relative w-24 h-24 flex-shrink-0 mr-4">
            <Image
              src={event.cover_photo || "/placeholder-image.jpg"}
              alt={event.name}
              layout="fill"
              objectFit="cover"
              className="rounded-lg"
              placeholder="blur"
              blurDataURL={placeholder}
            />
            {isFeatured && (
              <span className="absolute top-1 left-1 bg-yellow-400 text-black px-2 py-1 rounded-full text-xs font-bold z-10">
                Featured
              </span>
            )}
          </div>
          <div className="flex-grow">
            <h3 className="text-lg font-semibold mb-1 text-gray-800 dark:text-gray-200 line-clamp-1">
              {event.name}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-1">
              {formatDate(event.start_time)}
            </p>
            <p className="text-gray-500 dark:text-gray-500 text-sm">
              {event.account.name}
            </p>
          </div>
        </div>
      </Link>
    </motion.div>
  );
};
