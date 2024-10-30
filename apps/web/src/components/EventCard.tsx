import React from "react";
import Link from "next/link";
import Image from "next/image";
import { EventFromDB } from "@/types";
import { formatDate } from "@/utils/date";
import { motion } from "framer-motion";
import { placeholder } from "@/utils/shimmer";
import { FiExternalLink } from "react-icons/fi";

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
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden  md:h-[350px]"
    >
      <div className="relative h-48 group">
        <Image
          src={event.cover_photo || "/placeholder-image.jpg"}
          alt={event.name}
          fill
          className="transition-transform duration-300 ease-in-out transform"
          placeholder="blur"
          blurDataURL={placeholder}
        />
        <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-90 transition-opacity duration-300 flex flex-col items-center justify-center space-y-2 md:space-y-0 md:flex-row md:space-x-4 p-4">
          <Link href={`/event/${event.id}`}>
            <button className="bg-transparent border border-white text-white px-3 py-1 rounded hover:bg-white hover:text-black transition duration-300 text-sm md:px-4 md:py-2 md:text-base">
              View Details
            </button>
          </Link>
          <Link
            href={`https://www.facebook.com/events/${event.source_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-transparent border border-white text-white px-3 py-1 rounded hover:bg-white hover:text-black transition duration-300 text-sm md:px-4 md:py-2 md:text-base"
          >
            View Event on Facebook
            <FiExternalLink className="w-4 h-4" />
          </Link>
        </div>
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
    </motion.div>
  );
};
