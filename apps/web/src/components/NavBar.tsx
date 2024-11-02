import React from "react";
import { AccountsFromDB } from "@/types";
import { AccountSelector } from "./AccountSelector";
import { ViewButton } from "./ViewButton";
import DateSelector from "./DateSelector";

interface NavBarProps {
  accounts: AccountsFromDB[];
  selectedAccount: number | null;
  setSelectedAccount: (id: number | null) => void;
  view: "card" | "list" | "bento";
  setView: (view: "card" | "list" | "bento") => void;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  selectedYear: string;
  setSelectedYear: (year: string) => void;
}

export const NavBar: React.FC<NavBarProps> = ({
  accounts,
  selectedAccount,
  setSelectedAccount,
  view,
  setView,
  selectedMonth,
  setSelectedMonth,
  selectedYear,
  setSelectedYear,
}) => {
  const months = [
    "All Months",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const currentYear = new Date().getFullYear();
  const years = [
    "All Years",
    ...Array.from({ length: currentYear - 2017 + 1 }, (_, i) =>
      (currentYear - i).toString()
    ),
  ];

  return (
    <div className="w-full flex flex-col md:flex-row gap-2">
      <div className="w-full md:w-auto">
        <AccountSelector
          accounts={accounts}
          selectedAccount={selectedAccount}
          setSelectedAccount={setSelectedAccount}
        />
      </div>
      <div className="w-full md:w-auto">
        <DateSelector
          options={months}
          selected={selectedMonth}
          onChange={setSelectedMonth}
          className="relative w-full md:w-32"
        />
      </div>
      <div className="w-full md:w-auto">
        <DateSelector
          options={years}
          selected={selectedYear}
          onChange={setSelectedYear}
          className="relative w-full md:w-28"
        />
      </div>
      <div className="w-full md:w-auto flex justify-center md:justify-start ml-auto">
        <div className="flex space-x-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <ViewButton
            view="card"
            currentView={view}
            onClick={() => setView("card")}
            icon={
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
              />
            }
          />
          <ViewButton
            view="list"
            currentView={view}
            onClick={() => setView("list")}
            icon={
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 10h16M4 14h16M4 18h16"
              />
            }
          />
          <ViewButton
            view="bento"
            currentView={view}
            onClick={() => setView("bento")}
            icon={
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
              />
            }
          />
        </div>
      </div>
    </div>
  );
};
