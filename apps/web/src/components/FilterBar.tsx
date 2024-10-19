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
  view: "card" | "list";
  setView: (view: "card" | "list") => void;
}) {
  return (
    <div className="flex items-center justify-between mt-4 p-4 px-12">
      <div className="text-3xl font-bold">CebEvents</div>
      <div className="flex items-center space-x-4">
        <select
          className="p-2 border border-gray-300 rounded"
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
  );
}
