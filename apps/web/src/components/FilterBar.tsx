import React from "react";
import { AccountsFromDB } from "@/types";
import Link from "next/link";
import Logo from "./Logo";
import AddToCalendar from "./AddToCalendar";

export function FilterBar({}: {
  accounts: AccountsFromDB[];
  selectedAccount: number | null;
  setSelectedAccount: (id: number | null) => void;
  view: "card" | "list" | "bento";
  setView: (view: "card" | "list" | "bento") => void;
}) {
  return (
    <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 shadow-md">
      <div className="container mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between">
        <Logo />
        <div className="flex flex-wrap items-center justify-center md:justify-end space-y-2 md:space-y-0 space-x-0 md:space-x-4 space-x-4">
          <AddToCalendar />
          <Link href="/authorize" passHref>
            <button
              className="w-full md:w-auto px-4 py-2 bg-blue-500 dark:bg-blue-600 text-white rounded-lg hover:bg-blue-600 dark:hover:bg-blue-700 font-bold relative overflow-hidden group transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-50"
              aria-label="Add Your Events"
            >
              <span className="relative z-10">Add Your Events</span>
              <span className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></span>
              <span className="absolute inset-0 scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-300 bg-white dark:bg-gray-200 opacity-25"></span>
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
