import React from "react";
import Link from "next/link";
import Image from "next/image";
import { EventFromDB } from "../pages/calendar";
import { renderTextWithLineBreaks } from "@/utils/text";
import { placeholder } from "@/utils/shimmer";
import { formatDate } from "@/utils/dateUtils";

interface EventCardProps {
  event: EventFromDB;
  showFacebookButton?: boolean;
}

export function EventCard({
  event,
  showFacebookButton = false,
}: EventCardProps) {
  return (
    <li className="flex flex-col rounded-lg shadow-lg overflow-hidden transform transition duration-300 ease-in-out hover:scale-105 hover:shadow-2xl hover:z-10 relative group bg-white dark:bg-gray-800">
      <Link
        href={`/event/${event.id}`}
        className="flex flex-col h-full relative"
      >
        {event.cover_photo && (
          <div className="flex-shrink-0 h-62 overflow-hidden">
            <div className="h-full w-full relative">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black opacity-0 group-hover:opacity-60 transition-opacity duration-300 z-10"></div>
              <Image
                src={event.cover_photo}
                alt={event.name}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                width={600}
                height={600}
                placeholder={placeholder}
              />
            </div>
          </div>
        )}
        <div className="flex-1 p-6 flex flex-col justify-between relative z-20">
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-300">
              {event.name}
              <br />
              <span className="text-gray-500 dark:text-gray-400 text-sm group-hover:text-blue-400 dark:group-hover:text-blue-300 transition-colors duration-300">
                {event.account.name}
              </span>
            </h3>
            <p className="mt-3 text-base text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors duration-300">
              {renderTextWithLineBreaks(
                event?.description && event.description.length > 100
                  ? `${event.description.substring(0, 100)}...`
                  : event?.description || ""
              )}
            </p>
          </div>
          <div className="mt-6 flex items-center">
            <div className="text-sm text-gray-500 dark:text-gray-400 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors duration-300">
              <time dateTime={event.start_time}>
                {new Date(event.start_time).toLocaleDateString()}
              </time>
            </div>
          </div>
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 opacity-0 group-hover:opacity-20 transition-opacity duration-300 rounded-lg"></div>
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></div>
        <div className="absolute top-0 right-0 w-1 h-full bg-gradient-to-b from-blue-500 to-purple-500 transform scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-top"></div>
        {showFacebookButton && event.source_id && (
          <a
            href={`https://facebook.com/events/${event.source_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md text-sm absolute top-2 right-2 z-30"
          >
            View on Facebook
          </a>
        )}
      </Link>
    </li>
  );
}
