import React from "react";
import Link from "next/link";
import Image from "next/image";
import { EventFromDB } from "../pages/calendar";
import { renderTextWithLineBreaks } from "@/utils/text";
import { placeholder } from "@/utils/shimmer";

export function EventCard({ event }: { event: EventFromDB }) {
  return (
    <li className="flex flex-col rounded-lg shadow-lg overflow-hidden">
      <Link href={`/event/${event.id}`} className="flex flex-col h-full">
        {event.cover_photo && (
          <div className="flex-shrink-0 h-62">
            <div className="h-full w-full relative">
              <div className="absolute top-0 z-[-2] h-screen w-screen bg-neutral-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))]"></div>
              <Image
                src={event.cover_photo}
                alt={event.name}
                className="h-full w-full object-contain"
                width={600}
                height={600}
                placeholder={placeholder}
              />
            </div>
          </div>
        )}
        <div className="flex-1 bg-white p-6 flex flex-col justify-between">
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-gray-900">
              {event.name}
              <br />
              <span className="text-gray-500 text-sm">
                {event.account.name}
              </span>
            </h3>
            <p className="mt-3 text-base text-gray-500">
              {renderTextWithLineBreaks(
                event?.description && event.description.length > 100
                  ? `${event.description.substring(0, 100)}...`
                  : event?.description || ""
              )}
            </p>
          </div>
          <div className="mt-6 flex items-center">
            <div className="text-sm text-gray-500">
              <time dateTime={event.start_time}>
                {new Date(event.start_time).toLocaleDateString()}
              </time>
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}
