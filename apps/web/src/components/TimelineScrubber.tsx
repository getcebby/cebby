import React from "react";
import { format } from "date-fns";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";

interface TimelineScrubberProps {
  sortedYears: string[];
  eventsByYear: { [year: string]: string[] };
  activeSection: string;
  showMobileScrubber: boolean;
  setShowMobileScrubber: (show: boolean) => void;
  scrollToSection: (sectionKey: string) => void;
}

export const TimelineScrubber = ({
  sortedYears,
  eventsByYear,
  activeSection,
  showMobileScrubber,
  setShowMobileScrubber,
  scrollToSection,
}: TimelineScrubberProps) => {
  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setShowMobileScrubber(!showMobileScrubber)}
        className="fixed md:hidden right-2 bottom-20 z-50 bg-white dark:bg-gray-800 rounded-full p-2 shadow-lg"
      >
        <ChevronLeftIcon
          className={`w-6 h-6 transition-transform duration-200 ${
            showMobileScrubber ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Timeline scrubber */}
      <div
        className={`
          fixed right-0 top-[64px] w-20 z-50 
          shadow-lg
          md:bg-transparent md:shadow-none
          transition-transform duration-200
          ${showMobileScrubber ? "translate-x-0" : "translate-x-full"}
          md:translate-x-0 md:hover:opacity-100 md:opacity-0
        `}
      >
        <div className="py-8 w-full">
          {sortedYears.map((year) => (
            <div key={year} className="relative mb-4">
              <div className="flex items-center justify-end mb-2 mr-4">
                <button
                  onClick={() => {
                    scrollToSection(eventsByYear[year][0]);
                    setShowMobileScrubber(false);
                  }}
                  className="text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-150"
                >
                  {year}
                </button>
              </div>
              <div className="space-y-1.5">
                {eventsByYear[year].map((yearMonth) => {
                  const isActive = activeSection === yearMonth;
                  const [year, month] = yearMonth.split("-");
                  const date = new Date(parseInt(year), parseInt(month) - 1);
                  const monthLabel = format(date, "MMM yyyy");

                  return (
                    <div
                      key={yearMonth}
                      className="flex items-center justify-end group cursor-pointer"
                      onClick={() => {
                        scrollToSection(yearMonth);
                        setShowMobileScrubber(false);
                      }}
                    >
                      <div className="relative flex items-center justify-end w-full">
                        <span className="absolute right-4 text-xs text-gray-500 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-all duration-150 group-hover:underline whitespace-nowrap">
                          {monthLabel}
                        </span>
                        <div
                          className={`
                            w-1.5 h-1.5 rounded-full transition-all duration-150
                            ${
                              isActive
                                ? "bg-blue-500 scale-125"
                                : "bg-gray-300 dark:bg-gray-600 group-hover:bg-blue-400 dark:group-hover:bg-blue-400"
                            }
                          `}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
