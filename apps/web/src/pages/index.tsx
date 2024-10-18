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

  const renderListEvents = (
    events: EventFromDB[],
    title: string,
    description: string
  ) => (
    <div className="py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
          {title}
        </h2>
        <p className="mt-3 max-w-2xl text-xl text-gray-500 sm:mt-4">
          {description}
        </p>
        <ul className="mt-12 space-y-4">
          {events.map((event, idx) => (
            <li
              key={idx}
              className="bg-white shadow overflow-hidden rounded-lg flex"
            >
              {event.cover_photo && (
                <div className="w-2/3 relative">
                  <div className="w-full h-full relative">
                    <Image
                      src={event.cover_photo}
                      alt={event.name}
                      className="object-cover w-full h-full"
                      layout="fill"
                    />
                  </div>
                </div>
              )}
              <div className="w-1/3 px-4 py-5 sm:px-6">
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900">
                    {event.name}
                  </h3>
                  <p className="mt-3 text-base text-gray-500">
                    {event?.description && event.description.length > 500
                      ? `${event.description.substring(0, 500)}...`
                      : event?.description}
                  </p>
                </div>
                <div className="mt-4 text-sm text-gray-500">
                  <time dateTime={event.start_time}>
                    {new Date(event.start_time).toLocaleDateString()}
                  </time>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  const renderEvents = (
    events: EventFromDB[],
    title: string,
    description: string
  ) => (
    <div className="py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
          {title}
        </h2>
        <p className="mt-3 max-w-2xl text-xl text-gray-500 sm:mt-4">
          {description}
        </p>
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event, idx) => (
            <li
              key={idx}
              className="flex flex-col rounded-lg shadow-lg overflow-hidden"
            >
              {event.cover_photo && (
                <div className="flex-shrink-0">
                  <Image
                    src={event.cover_photo}
                    alt={event.name}
                    className="h-48 w-full object-cover"
                    width={600}
                    height={600}
                  />
                </div>
              )}
              <div className="flex-1 bg-white p-6 flex flex-col justify-between">
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900">
                    {event.name}
                  </h3>
                  <p className="mt-3 text-base text-gray-500">
                    {event?.description && event.description.length > 500
                      ? `${event.description.substring(0, 500)}...`
                      : event?.description}
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
            </li>
          ))}
        </ul>
      </div>
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
