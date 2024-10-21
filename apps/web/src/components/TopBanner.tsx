import React, { useState } from "react";
import Link from "next/link";
import { FaGithub, FaBars, FaTimes } from "react-icons/fa";

const TopBanner: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white py-2 px-4">
      <div className="container mx-auto flex flex-col md:flex-row justify-between items-center">
        <p className="text-sm text-center md:text-left mb-2 md:mb-0">
          This project was proudly initiated during #Hacktoberfest Cebu 2024
        </p>
        <div className="flex items-center">
          <button
            className="md:hidden mr-2"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMenuOpen ? <FaTimes size={20} /> : <FaBars size={20} />}
          </button>
          <nav
            className={`${
              isMenuOpen ? "flex" : "hidden"
            } md:flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-4`}
          >
            <Link
              href="https://dorelljames.notion.site/3838c38a3b26421a8f43ec0b27e56f5d?v=1263f8eda070810eb633000cf6c1e421&pvs=74"
              className="text-sm hover:underline"
            >
              Roadmap
            </Link>
            <Link href="/feature-request" className="text-sm hover:underline">
              Request a Feature
            </Link>
            <a
              href="https://github.com/dorelljames/event-ni"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white hover:text-gray-200"
            >
              <FaGithub size={20} />
            </a>
          </nav>
        </div>
      </div>
    </div>
  );
};

export default TopBanner;
