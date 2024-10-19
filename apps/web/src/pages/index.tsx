/* eslint-disable @typescript-eslint/no-unused-vars */
import { createClient } from "@/utils/supabase/component";
import Image from "next/image";
import React, { useState } from "react";
import { AccountsFromDB, EventFromDB } from "./calendar";
import { renderTextWithLineBreaks } from "@/utils/supabase/text";
import { useRouter } from "next/router";
import { formatDistanceToNow } from "date-fns";

const supabase = createClient();

export default function Home({
  events,
  accounts,
  ...props
}: {
  events: EventFromDB[];
  accounts: AccountsFromDB[];
}) {
  const router = useRouter();
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [filteredEvents, setFilteredEvents] = useState(events);
  const [view, setView] = useState<"card" | "list">("card");
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  React.useEffect(() => {
    if (selectedAccount) {
      const filtered = events.filter(
        (event) => Number(event.account.id) === Number(selectedAccount)
      );
      setFilteredEvents(filtered);
    } else {
      setFilteredEvents(events);
    }
  }, [selectedAccount, events]);

  const upcomingEvents = filteredEvents
    .filter((event) => new Date(event.start_time) > now)
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

  const recentEvents = filteredEvents.filter(
    (event) =>
      new Date(event.start_time) >= startOfMonth &&
      new Date(event.start_time) <= now
  );
  const pastEvents = filteredEvents.filter(
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
          {description.split("\n").map((line, index) => (
            <span key={index}>
              {line}
              <br />
            </span>
          ))}
        </p>
        <ul className="mt-12 space-y-4">
          {events.map((event, idx) => (
            <li
              key={idx}
              className="bg-white shadow overflow-hidden rounded-lg flex"
            >
              {event.cover_photo && (
                <div className="w-1/2 relative">
                  <div>
                    <Image
                      placeholder={`data:image/svg+xml;base64,${toBase64(shimmer(700, 475))}`}
                      src={event.cover_photo}
                      alt={event.name}
                      className="h-62 w-full object-cover"
                      layout="fill"
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
                <div className="flex-shrink-0 h-62">
                  <div className="h-full w-full relative">
                    <div className="absolute top-0 z-[-2] h-screen w-screen bg-neutral-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))]"></div>
                    <Image
                      placeholder={`data:image/svg+xml;base64,${toBase64(shimmer(700, 475))}`}
                      src={event.cover_photo}
                      alt={event.name}
                      className="h-full w-full object-contain"
                      width={600}
                      height={600}
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
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mt-4 p-4 px-12">
        <div className="text-3xl font-bold">CebEvents</div>
        <div className="flex items-center">
          <select
            className="p-2 border border-gray-300 rounded"
            onChange={(e) => setSelectedAccount(Number(e.target.value))}
            aria-label="Filter by Account"
            title="Filter by Account"
          >
            <option value="">All Accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
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
          <button
            className="ml-4 p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-bold"
            aria-label="Authorize"
            title="Authorize"
          >
            Add Your Events Today!
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
    .select(
      `
      *,
      account:account_id (
        id,
        name,
        type
      )
    `
    )
    .order("start_time", { ascending: false });

  if (error) {
    console.error(error);
  } else {
    console.log(data);
  }

  return {
    props: {
      events: data,
      accounts: Array.from(
        new Map(
          data?.map((event) => [event.account.id, event.account])
        ).values()
      ),
    },
  };
}

const shimmer = (w: number, h: number) => `
<svg width="${w}" height="${h}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="g">
      <stop stop-color="#333" offset="20%" />
      <stop stop-color="#222" offset="50%" />
      <stop stop-color="#333" offset="70%" />
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="#333" />
  <rect id="r" width="${w}" height="${h}" fill="url(#g)" />
  <animate xlink:href="#r" attributeName="x" from="-${w}" to="${w}" dur="1s" repeatCount="indefinite"  />
</svg>`;

const toBase64 = (str: string) =>
  typeof window === "undefined"
    ? Buffer.from(str).toString("base64")
    : window.btoa(str);
