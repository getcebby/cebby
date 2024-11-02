import React from "react";
import { AccountsFromDB } from "@/types";
import Logo from "./Logo";
import AddToCalendar from "./AddToCalendar";
import { AddEventsButton } from "./AddEventsButton";

export function FilterBar({}: {
  accounts: AccountsFromDB[];
  selectedAccount: number | null;
  setSelectedAccount: (id: number | null) => void;
  view: "card" | "list" | "bento";
  setView: (view: "card" | "list" | "bento") => void;
}) {
  return (
    <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 shadow-md">
      <div className="container mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <Logo />
        <div className="flex flex-col md:flex-row items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 w-full md:w-auto">
            {/* Add your DateSelectors here in a flex container */}
            {/* Example: */}
            {/* <DateSelector ... /> */}
            {/* <DateSelector ... /> */}
            {/* <DateSelector ... /> */}
          </div>
          <div className="flex items-center gap-2">
            <AddToCalendar />
            <AddEventsButton />
          </div>
        </div>
      </div>
    </div>
  );
}
