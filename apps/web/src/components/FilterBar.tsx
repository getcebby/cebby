import React, { useState, useRef, useEffect } from "react";
import { AccountsFromDB } from "../pages/calendar";
import Link from "next/link";

export function FilterBar({
  accounts,
  selectedAccount,
  setSelectedAccount,
  view,
  setView,
}: {
  accounts: AccountsFromDB[];
  selectedAccount: number | null;
  setSelectedAccount: (id: number | null) => void;
  view: "card" | "list" | "bento";
  setView: (view: "card" | "list" | "bento") => void;
}) {
  return (
    <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 shadow-md">
      <div className="flex flex-col md:flex-row items-center justify-between p-4 md:px-12">
        <div className="text-2xl md:text-3xl font-bold relative group mb-4 md:mb-0">
          <Link href="/">
            <span className="relative z-10">CebEvents</span>
          </Link>
          <span className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 opacity-0 group-hover:opacity-100 blur transition-all duration-300 z-0"></span>
        </div>
        <div className="flex flex-wrap items-center justify-center md:justify-end space-y-2 md:space-y-0 space-x-0 md:space-x-4">
          <AccountSelector
            accounts={accounts}
            selectedAccount={selectedAccount}
            setSelectedAccount={setSelectedAccount}
          />
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

function AccountSelector({
  accounts,
  selectedAccount,
  setSelectedAccount,
}: {
  accounts: AccountsFromDB[];
  selectedAccount: number | null;
  setSelectedAccount: (id: number | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const filteredAccounts = accounts.filter((account) =>
    account.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedAccountName =
    selectedAccount !== null
      ? accounts.find((account) => Number(account.id) === selectedAccount)?.name
      : "All Accounts";

  return (
    <div className="relative w-full md:w-64" ref={dropdownRef}>
      <button
        className="w-full p-2 text-left bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="truncate mr-2">{selectedAccountName}</span>
        <svg
          className="h-5 w-5 text-gray-400 flex-shrink-0"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
        >
          <path
            d="M7 7l3-3 3 3m0 6l-3 3-3-3"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg">
          <div className="p-2">
            <input
              type="text"
              className="w-full p-2 border border-gray-300 dark:bg-gray-700 dark:border-gray-700 rounded-md"
              placeholder="Search accounts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <ul className="max-h-60 overflow-auto">
            <li
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer truncate"
              onClick={() => {
                setSelectedAccount(null);
                setIsOpen(false);
              }}
            >
              All Accounts
            </li>
            {filteredAccounts.map((account) => (
              <li
                key={account.id}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer truncate"
                onClick={() => {
                  setSelectedAccount(Number(account.id));
                  setIsOpen(false);
                }}
              >
                {account.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ViewButton({
  view,
  currentView,
  onClick,
  icon,
}: {
  view: string;
  currentView: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  const isActive = view === currentView;
  return (
    <button
      className={`p-2 rounded-md transition-all duration-300 ${
        isActive
          ? "bg-white dark:bg-gray-700 text-blue-500 dark:text-blue-400 shadow-md"
          : "text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
      }`}
      onClick={onClick}
      aria-label={`${view.charAt(0).toUpperCase() + view.slice(1)} View`}
      aria-pressed={isActive}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6"
      >
        {icon}
      </svg>
    </button>
  );
}
