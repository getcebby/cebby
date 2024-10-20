import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { EventFromDB } from "../pages/calendar";
import { formatDate } from "@/utils/date";
import { motion } from "framer-motion";

interface EventBentoItemProps {
  event: EventFromDB;
  isFeatured: boolean;
}

export const EventBentoItem: React.FC<EventBentoItemProps> = ({
  event,
  isFeatured,
}) => {
  const [aspectRatio, setAspectRatio] = useState<"square" | "rectangular">(
    "rectangular"
  );

  const handleImageLoad = ({
    naturalWidth,
    naturalHeight,
  }: {
    naturalWidth: number;
    naturalHeight: number;
  }) => {
    const ratio = naturalWidth / naturalHeight;
    setAspectRatio(ratio > 1.2 || ratio < 0.8 ? "rectangular" : "square");
  };

  const itemVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { opacity: 1, scale: 1 },
  };

  return (
    <motion.div
      variants={itemVariants}
      initial="hidden"
      animate="visible"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ duration: 0.3 }}
    >
      <Link href={`/event/${event.id}`}>
        <div
          className={`relative overflow-hidden rounded-lg shadow-lg w-full h-full
            ${
              isFeatured
                ? "aspect-[16/9]"
                : aspectRatio === "square"
                  ? "aspect-square"
                  : "aspect-[4/3]"
            }`}
        >
          <Image
            src={event.cover_photo || "/placeholder-image.jpg"}
            alt={event.name}
            layout="fill"
            objectFit="cover"
            className="transition-transform duration-300 ease-in-out transform hover:scale-110"
            onLoadingComplete={handleImageLoad}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-70"></div>
          {isFeatured && (
            <span className="absolute top-4 left-4 bg-yellow-400 text-black px-3 py-2 rounded-full text-sm font-bold z-10">
              Featured
            </span>
          )}
          <div className="absolute bottom-0 left-0 p-4 text-white">
            <h3
              className={`font-bold ${
                isFeatured ? "text-2xl" : "text-lg"
              } mb-2 line-clamp-2`}
            >
              {event.name}
            </h3>
            <p className="text-sm">{formatDate(event.start_time)}</p>
          </div>
        </div>
      </Link>
    </motion.div>
  );
};
