import { useState } from "react";
import { EventData } from "facebook-event-scraper";

export default function AddEvent() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [eventData, setEventData] = useState<EventData | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");

    try {
      const response = await fetch("/api/events/add_by_url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error("Failed to add event");
      }

      const result = await response.json();
      setEventData(result.data);
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Something went wrong"
      );
    }
  };

  if (status === "success" && eventData) {
    return (
      <div className="max-w-2xl mx-auto p-4 mt-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
          {/* Event Image */}
          {eventData.photo && (
            <div className="relative h-48 sm:h-64">
              <img
                src={eventData.photo.imageUri}
                alt={eventData.name}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Event Content */}
          <div className="p-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {eventData.name}
            </h1>

            {/* Date and Time */}
            <div className="flex items-center text-gray-600 dark:text-gray-300 mb-4">
              <svg
                className="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span>{eventData.formattedDate}</span>
            </div>

            {/* Location */}
            <div className="flex items-start text-gray-600 dark:text-gray-300 mb-4">
              <svg
                className="w-5 h-5 mr-2 mt-1 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <div>
                <p className="font-medium">{eventData?.location?.name}</p>
                <p>{eventData?.location?.address}</p>
                <p>{eventData?.location?.city?.name}</p>
              </div>
            </div>

            {/* Description */}
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              {eventData.description.length > 200
                ? `${eventData.description.substring(0, 200)}...`
                : eventData.description}
            </p>

            {/* Hosts */}
            {eventData.hosts.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                  Hosted by:
                </h2>
                <div className="flex items-center">
                  {eventData.hosts.map((host, index) => (
                    <div key={index} className="flex items-center mr-4">
                      <img
                        src={host.photo.imageUri}
                        alt={host.name}
                        className="w-8 h-8 rounded-full mr-2"
                      />
                      <span className="text-sm text-gray-600 dark:text-gray-300">
                        {host.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              {eventData.url && (
                <a
                  href={eventData.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-center
                           hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  View on Facebook
                </a>
              )}
              <button
                onClick={() => {
                  setStatus("idle");
                  setUrl("");
                  setEventData(null);
                }}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 
                         rounded-md text-center hover:bg-gray-300 dark:hover:bg-gray-600 
                         transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Add Another Event
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 mt-8">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">
        Add Event by URL
      </h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Enter event URL"
          required
          className="w-full px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 
                   bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                   focus:ring-2 focus:ring-blue-500 focus:border-transparent
                   placeholder-gray-400 dark:placeholder-gray-500"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md
                   disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors
                   dark:bg-blue-700 dark:hover:bg-blue-600 dark:disabled:bg-gray-600
                   focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {status === "loading" ? "Adding..." : "Add Event"}
        </button>
      </form>
      {status === "error" && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-md">
          <p className="text-red-700 dark:text-red-200">
            Error: {errorMessage}
          </p>
        </div>
      )}
    </div>
  );
}
