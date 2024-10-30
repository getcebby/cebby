import React, { useState, useRef, useEffect } from "react";
import { AccountsFromDB } from "@/types";

interface AccountSelectorProps {
  accounts: AccountsFromDB[];
  selectedAccount: number | null;
  setSelectedAccount: (id: number | null) => void;
}

export const AccountSelector: React.FC<AccountSelectorProps> = ({
  accounts,
  selectedAccount,
  setSelectedAccount,
}) => {
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
            {filteredAccounts.map((account) => {
              return (
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
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
