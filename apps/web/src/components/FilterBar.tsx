import React from "react";
import { AccountsFromDB } from "../pages/calendar";

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
    <div className="flex items-center justify-between mt-4 p-4 px-12">
      <div className="text-3xl font-bold relative group">
        <span className="relative z-10">CebEvents</span>
        <span className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 opacity-0 group-hover:opacity-100 blur transition-all duration-300 z-0"></span>
      </div>
      <div className="flex items-center space-x-4">
        <select
          className="p-2 border border-gray-300 rounded transition-all duration-300 hover:border-blue-500 focus:ring focus:ring-blue-200 focus:outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          onChange={(e) => setSelectedAccount(Number(e.target.value) || null)}
          value={selectedAccount || ""}
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
        <ViewButton
          view="list"
          currentView={view}
          onClick={() => setView("list")}
          icon={
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 6.75h15M4.5 12h15m-15 5.25h15"
            />
          }
        />
        <ViewButton
          view="card"
          currentView={view}
          onClick={() => setView("card")}
          icon={
            <>
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
            </>
          }
        />
        <ViewButton
          view="bento"
          currentView={view}
          onClick={() => setView("bento")}
          icon={
            <>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
              />
            </>
          }
        />
        <button
          className="ml-4 p-2 bg-blue-500 dark:bg-blue-600 text-white rounded-lg hover:bg-blue-600 dark:hover:bg-blue-700 font-bold relative overflow-hidden group transition-all duration-300 transform hover:scale-105"
          aria-label="Authorize"
          title="Authorize"
        >
          <span className="relative z-10">Add Your Events Today!</span>
          <span className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></span>
          <span className="absolute inset-0 scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-300 bg-white dark:bg-gray-200 opacity-25"></span>
        </button>
      </div>
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
  return (
    <button
      className={`p-2 relative group ${
        view === currentView
          ? "text-blue-500 dark:text-blue-400"
          : "text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400"
      } transition-colors duration-300`}
      onClick={onClick}
      aria-label={`${view.charAt(0).toUpperCase() + view.slice(1)} View`}
      title={`${view.charAt(0).toUpperCase() + view.slice(1)} View`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6 transition-transform duration-300 group-hover:scale-110"
      >
        {icon}
      </svg>
      <span className="absolute inset-0 border-b-2 border-blue-500 dark:border-blue-400 scale-x-0 group-hover:scale-x-100 transition-transform duration-300"></span>
    </button>
  );
}
