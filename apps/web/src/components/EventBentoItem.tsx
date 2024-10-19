import React from "react";
import Link from "next/link";
import Image from "next/image";
import { EventFromDB } from "../pages/calendar";
import { renderTextWithLineBreaks } from "@/utils/text";
import { placeholder } from "@/utils/shimmer";

export function EventBentoItem({
  event,
  index,
}: {
  event: EventFromDB;
  index: number;
}) {
  const isLarge = index % 5 === 0 || index % 5 === 4;

  return (
    <Link
      href={`/event/${event.id}`}
      className={`group relative overflow-hidden rounded-lg shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:z-10 ${
        isLarge ? "md:col-span-2 md:row-span-2" : ""
      }`}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black opacity-60 transition-opacity duration-300 group-hover:opacity-80 z-10"></div>
      {event.cover_photo && (
        <div
          className={`w-full ${isLarge ? "h-96" : "h-48"} relative overflow-hidden`}
        >
          <Image
            src={event.cover_photo}
            alt={event.name}
            className="object-cover transition-transform duration-300 group-hover:scale-110"
            layout="fill"
            placeholder={placeholder}
          />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-4 z-20">
        <h3 className="text-lg font-semibold text-white group-hover:text-blue-300 transition-colors duration-300">
          {event.name}
        </h3>
        <p className="text-sm text-gray-300 group-hover:text-blue-200 transition-colors duration-300">
          {event.account.name}
        </p>
        {isLarge && (
          <p className="mt-2 text-sm text-gray-300 group-hover:text-blue-200 transition-colors duration-300">
            {renderTextWithLineBreaks(
              event?.description && event.description.length > 100
                ? `${event.description.substring(0, 100)}...`
                : event?.description || ""
            )}
          </p>
        )}
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 opacity-0 group-hover:opacity-20 transition-opacity duration-300 rounded-lg"></div>
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></div>
      <div className="absolute top-0 right-0 w-1 h-full bg-gradient-to-b from-blue-500 to-purple-500 transform scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-top"></div>
    </Link>
  );
}
