/* eslint-disable @typescript-eslint/no-unused-vars */
import { createClient } from "@/utils/supabase/component";
import Image from "next/image";
import { useState } from "react";
import { EventFromDB } from "./calendar";

const supabase = createClient();

export default function Home({ events, ...props }: { events: EventFromDB[] }) {
  const [view, setView] = useState<"card" | "list">("list");
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

  const renderListEvents = (
    events: EventFromDB[],
    title: string,
    description: string
  ) => (
    <div className="p-12">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">{title}</h2>
      <p className="text-sm text-gray-500 mb-6">{description}</p>
      <ul className="space-y-4">
        {events.map((event, idx) => (
          <li
            key={idx}
            className="p-4 bg-white rounded-lg shadow-md flex flex-col md:flex-row"
          >
            {event.cover_photo && (
              <div className="md:w-1/4 mb-4 md:mb-0 md:mr-4">
                <Image
                  src={event.cover_photo}
                  alt={event.name}
                  className="w-full h-48 object-cover rounded-lg"
                  width={600}
                  height={600}
                />
              </div>
            )}
            <div className="md:w-3/4">
              <h1 className="text-xl font-bold text-gray-900">{event.name}</h1>
              <p className="text-gray-700 mt-2">{event?.description}</p>
              <p className="text-gray-500 mt-4 text-sm">
                {new Date(event.start_time).toLocaleDateString()}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div>
      <div className="flex flex-col items-center mt-4   p-4">
        <div className="mb-4 text-3xl font-bold">CebEvents</div>
        <div className="flex border-b border-gray-200">
          <button
            className={`p-2 ${
              view === "list"
                ? "border-b-2 border-blue-500 text-blue-500"
                : "text-gray-500"
            }`}
            onClick={() => setView("list")}
            aria-label="List View"
            title="List View"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 6.75h15M4.5 12h15m-15 5.25h15"
              />
            </svg>
          </button>
          <button
            className={`p-2 ${
              view === "card"
                ? "border-b-2 border-blue-500 text-blue-500"
                : "text-gray-500"
            }`}
            onClick={() => setView("card")}
            aria-label="Card View"
            title="Card View"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4h16v16H4z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 10h16M10 4v16"
              />
            </svg>
          </button>
        </div>
      </div>
      {view === "card" ? (
        <>
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
        </>
      ) : (
        <>
          {renderListEvents(
            upcomingEvents,
            "Upcoming Events",
            "Happening pretty soon..."
          )}
          {renderListEvents(
            recentEvents,
            "Recent Events",
            "Events you might have missed this month..."
          )}
          {renderListEvents(
            pastEvents,
            "Past Events",
            "Events that happened in the past..."
          )}
        </>
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
