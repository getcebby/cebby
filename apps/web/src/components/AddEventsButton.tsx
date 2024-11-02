import React from "react";
import Link from "next/link";
import { BsCalendarPlus } from "react-icons/bs";

export const AddEventsButton = () => {
  return (
    <Link href="/authorize" passHref>
      <button
        className="relative inline-flex items-center gap-2 px-4 py-2 bg-blue-500 dark:bg-blue-600 text-white rounded-lg hover:bg-blue-600 dark:hover:bg-blue-700 font-bold relative overflow-hidden group transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-50"
        aria-label="Add Your Events"
      >
        <BsCalendarPlus className="w-5 h-5 hover:text-black" />
        <span className="relative z-10">Add Your Events</span>
        <span className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></span>
        <span className="absolute inset-0 scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-300 bg-white dark:bg-gray-200 opacity-25"></span>
      </button>
    </Link>
  );
};
