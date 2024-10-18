/* eslint-disable @typescript-eslint/no-unused-vars */
import { createClient } from "@/utils/supabase/component";
import {
  FaceFrownIcon,
  FaceSmileIcon,
  FireIcon,
  HandThumbUpIcon,
  HeartIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { useState } from "react";
import { EventFromDB } from "./calendar";
import Image from "next/image";

const supabase = createClient();

export default function Home({ events, ...props }: { events: EventFromDB[] }) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const upcomingEvents = events.filter(
    (event) => new Date(event.start_time) > now
  );
  const recentEvents = events.filter(
    (event) =>
      new Date(event.start_time) >= startOfMonth &&
      new Date(event.start_time) <= now
  );
  const pastEvents = events.filter(
    (event) => new Date(event.start_time) < startOfMonth
  );

  const renderEvents = (
    events: EventFromDB[],
    title: string,
    description: string
  ) => (
    <div className="p-12">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">{title}</h2>
      <p className="text-sm text-muted mb-6">{description}</p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {events.map((event, idx) => (
          <div key={idx} className="p-4 mb-4 bg-white rounded-lg shadow-md">
            {event.cover_photo && (
              <Image
                src={event.cover_photo}
                alt={event.name}
                className="w-full h-48 object-cover rounded-t-lg"
                width={600}
                height={600}
              />
            )}
            <div className="p-4">
              <h1 className="text-xl font-bold text-gray-900">{event.name}</h1>
              <p className="text-gray-700">
                {event?.description && event.description.length > 100
                  ? `${event.description.substring(0, 100)}...`
                  : event?.description}
              </p>
              <p className="text-gray-500 mt-2">
                {new Date(event.start_time).toLocaleDateString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      {renderEvents(
        upcomingEvents,
        "Upcoming Events",
        "Happening pretty soon..."
      )}
      {renderEvents(
        recentEvents,
        "Recent Events",
        "Events you might have missed this month..."
      )}
      {renderEvents(
        pastEvents,
        "Past Events",
        "Events that happened in the past..."
      )}
    </div>
  );
}

export async function getServerSideProps() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("start_time", { ascending: false });

  if (error) {
    console.error(error);
  } else {
    console.log(data);
  }

  return {
    props: {
      events: data,
    },
  };
}
