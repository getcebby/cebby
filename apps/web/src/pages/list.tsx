/* eslint-disable @typescript-eslint/no-unused-vars */
import { createClient } from "@/utils/supabase/component";
import {
  FaceFrownIcon,
  FaceSmileIcon,
  FireIcon,
  HandThumbUpIcon,
  HeartIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { useState } from "react";
import { EventFromDB } from "./index";
import Image from "next/image";

const supabase = createClient();

export default function Home({ events, ...props }: { events: EventFromDB[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {events.map((event, idx) => (
        <div key={idx} className="p-4 mb-4 bg-white rounded-lg shadow-md">
          {event.cover_photo && (
            <Image
              src={event.cover_photo}
              alt={event.name}
              className="w-full h-48 object-cover rounded-t-lg"
              width={600}
              height={600}
            />
          )}
          <div className="p-4">
            <h1 className="text-xl font-bold text-gray-900">{event.name}</h1>
            <p className="text-gray-700">
              {event?.description && event.description.length > 100
                ? `${event.description.substring(0, 100)}...`
                : event?.description}
            </p>
            <p className="text-gray-500 mt-2">
              {new Date(event.start_time).toLocaleDateString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export async function getServerSideProps() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("start_time", { ascending: false });

  if (error) {
    console.error(error);
  } else {
    console.log(data);
  }

  return {
    props: {
      events: data,
    },
  };
}
