import React from "react";
import Link from "next/link";
import Image from "next/image";
import { EventFromDB } from "../pages/calendar";
import { renderTextWithLineBreaks } from "@/utils/text";
import { formatDistanceToNow } from "date-fns";
import { placeholder } from "@/utils/shimmer";

export function EventListItem({ event }: { event: EventFromDB }) {
  return (
    <li className="bg-white dark:bg-gray-800 shadow overflow-hidden rounded-lg flex transform transition duration-300 ease-in-out hover:scale-102 hover:shadow-2xl hover:z-10 relative group">
      <Link href={`/event/${event.id}`} className="w-full flex relative">
        {event.cover_photo && (
          <div className="w-1/2 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black opacity-0 group-hover:opacity-60 transition-opacity duration-300 z-10"></div>
            <Image
              src={event.cover_photo}
              alt={event.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
              layout="fill"
              placeholder={placeholder}
            />
          </div>
        )}
        <div className="w-1/2 px-4 py-5 sm:px-6 relative z-20">
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-300">
              {event.name}
              <br />
              <span className="text-gray-500 dark:text-gray-400 text-sm group-hover:text-blue-400 dark:group-hover:text-blue-300 transition-colors duration-300">
                {event.account.name}
              </span>
            </h3>
            <div className="mt-2 mb-8 text-sm text-gray-500 dark:text-gray-400 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors duration-300">
              <time
                dateTime={event.start_time}
                title={new Date(event.start_time).toLocaleString()}
                className="relative group"
              >
                {formatDistanceToNow(new Date(event.start_time), {
                  addSuffix: true,
                })}{" "}
                · {new Date(event.start_time).toLocaleString()}
              </time>
            </div>
            <p className="mt-3 text-base text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors duration-300">
              {renderTextWithLineBreaks(
                event?.description && event.description.length > 250
                  ? `${event.description.substring(0, 250)}...`
                  : event?.description || ""
              )}
            </p>
          </div>
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 opacity-0 group-hover:opacity-20 transition-opacity duration-300 rounded-lg"></div>
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></div>
        <div className="absolute top-0 right-0 w-1 h-full bg-gradient-to-b from-blue-500 to-purple-500 transform scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-top"></div>
      </Link>
    </li>
  );
}
