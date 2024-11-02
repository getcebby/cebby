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
      className="group bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden flex flex-col h-full"
    >
      <div className="relative w-full aspect-video">
        <Image
          src={event.cover_photo || "/placeholder-image.jpg"}
          alt={event.name}
          fill
          className="object-cover rounded-t-lg"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          placeholder="blur"
          blurDataURL={placeholder}
          unoptimized
        />
        <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-90 transition-opacity duration-300 flex flex-col items-center justify-center gap-4 p-4">
          <Link href={`/event/${event.id}`} className="w-full max-w-[200px]">
            <button className="w-full bg-transparent border-2 border-white text-white px-4 py-3 rounded-lg hover:bg-white hover:text-black transition duration-300 text-sm font-medium">
              View Details
            </button>
          </Link>
          <Link
            href={`https://www.facebook.com/events/${event.source_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full max-w-[200px]"
          >
            <button className="w-full flex items-center justify-center gap-2 bg-transparent border-2 border-white text-white px-4 py-3 rounded-lg hover:bg-white hover:text-black transition duration-300 text-sm font-medium">
              <span>View on Facebook</span>
              <FiExternalLink className="w-4 h-4" />
            </button>
          </Link>
        </div>
        {isFeatured && (
          <span className="absolute top-4 left-4 bg-yellow-400 text-black px-3 py-2 rounded-full text-sm font-bold z-10">
            Featured
          </span>
        )}
      </div>
      <div className="p-4 flex flex-col flex-grow">
        <h3 className="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-200 line-clamp-2">
          {event.name}
        </h3>
        <div className="mt-auto">
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            {formatDate(event.start_time)}
          </p>
          <p className="text-gray-500 dark:text-gray-500 text-sm">
            {event.account.name}
          </p>
        </div>
      </div>
    </motion.div>
  );
};
