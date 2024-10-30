import React, { useState, useRef, useEffect } from "react";
import { ChevronDownIcon } from "@heroicons/react/20/solid";

interface SelectProps {
  options: string[];
  selected: string;
  onChange: (value: string) => void;
  className?: string;
}

const DateSelector: React.FC<SelectProps> = ({
  options,
  selected,
  onChange,
  className = "relative w-full md:w-32",
}) => {
  const [isOpen, setIsOpen] = useState(false);
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

  return (
    <div className={`${className}`} ref={dropdownRef}>
      <button
        className="w-full p-2 text-left bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="truncate mr-2">{selected}</span>
        <ChevronDownIcon
          className="h-5 w-5 text-gray-400 flex-shrink-0"
          aria-hidden="true"
        />
      </button>
      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg">
          <ul className="max-h-60 overflow-auto">
            {options.map((option) => (
              <li
                key={option}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer truncate"
                onClick={() => {
                  onChange(option);
                  setIsOpen(false);
                }}
              >
                {option}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default DateSelector;
