import React from "react";

interface ViewButtonProps {
  view: string;
  currentView: string;
  onClick: () => void;
  icon: React.ReactNode;
}

export const ViewButton: React.FC<ViewButtonProps> = ({
  view,
  currentView,
  onClick,
  icon,
}) => {
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
};
