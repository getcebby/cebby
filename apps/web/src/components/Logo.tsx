import React from "react";
import Link from "next/link";
import { app } from "@/config/app";

const Logo: React.FC = () => {
  return (
    <div className="text-2xl md:text-3xl font-bold relative group">
      <Link href="/">
        <span className="relative z-10">{app.title}</span>
      </Link>
      <span className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 opacity-0 group-hover:opacity-100 blur transition-all duration-300 z-0"></span>
    </div>
  );
};

export default Logo;
