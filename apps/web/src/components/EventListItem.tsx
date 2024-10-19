import React from "react";
import Link from "next/link";
import Image from "next/image";
import { EventFromDB } from "../pages/calendar";
import { renderTextWithLineBreaks } from "@/utils/text";
import { formatDistanceToNow } from "date-fns";
import { placeholder } from "@/utils/shimmer";

export function EventListItem({ event }: { event: EventFromDB }) {
  return (
    <li className="bg-white shadow overflow-hidden rounded-lg flex">
      <Link href={`/event/${event.id}`} className="w-full flex">
        {event.cover_photo && (
          <div className="w-1/2 relative">
            <div>
              <Image
                src={event.cover_photo}
                alt={event.name}
                className="h-62 w-full object-cover"
                layout="fill"
                placeholder={placeholder}
              />
            </div>
          </div>
        )}
        <div className="w-1/2 px-4 py-5 sm:px-6">
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-900">
              {event.name}
              <br />
              <span className="text-gray-500 text-sm">
                {event.account.name}
              </span>
            </h3>
            <div className="mt-2 mb-8 text-sm text-gray-500">
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
            <p className="mt-3 text-base text-gray-500">
              {renderTextWithLineBreaks(
                event?.description && event.description.length > 250
                  ? `${event.description.substring(0, 250)}...`
                  : event?.description || ""
              )}
            </p>
          </div>
        </div>
      </Link>
    </li>
  );
}
