import React from "react";
import Link from "next/link";
import { FaGithub } from "react-icons/fa";

const TopBanner: React.FC = () => {
  return (
    <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white py-2 px-4">
      <div className="container mx-auto flex justify-between items-center">
        <p className="text-sm">
          This project was proudly initiated during #Hacktoberfest Cebu 2024
        </p>
        <div className="flex items-center space-x-4">
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
        </div>
      </div>
    </div>
  );
};

export default TopBanner;
