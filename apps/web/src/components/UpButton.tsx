import React, { useEffect, useState } from "react";
import { ArrowUpIcon } from "@heroicons/react/20/solid";

const UpButton: React.FC = () => {
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  const handleScroll = () => {
    if (window.scrollY > 300) {
      setShowScrollToTop(true);
    } else {
      setShowScrollToTop(false);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <>
      {showScrollToTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-10 right-10 bg-blue-500 text-white rounded-full shadow-lg overflow-hidden group p-4"
        >
          <span className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></span>
          <span className="absolute inset-0 scale-x-0 group-hover:scale-x-100 origin-up transition-transform duration-300 bg-white dark:bg-gray-200 opacity-25"></span>
          <ArrowUpIcon className="w-10 h-10 relative z-10" />
        </button>
      )}
    </>
  );
};

export default UpButton;
