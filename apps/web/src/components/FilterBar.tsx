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
      <div className="container mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between">
        <Logo />
        <div className="flex flex-wrap items-center justify-center md:justify-end space-y-2 md:space-y-0 space-x-0 md:space-x-4 space-x-4">
          <AddToCalendar />
          <AddEventsButton />
        </div>
      </div>
    </div>
  );
}
