// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from "next";
import { scrapeFbEvent, EventData } from "facebook-event-scraper";
import createClient from "@/utils/supabase/api";
import { EventFromDB } from "@/types";
type Data = {
  success: boolean;
  data?: EventData;
  message?: string;
  error?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, error: "URL is required" });
    }

    let eventData;

    try {
      eventData = await scrapeFbEvent(url);
      console.log(eventData);
    } catch (err) {
      console.error(err);
    }

    if (!eventData) {
      return res.status(400).json({ success: false, error: "Event not found" });
    }

    // Now, let's save this event to the database
    const supabase = createClient(req, res);
    const supabaseEvent = await supabase
      .from("events")
      .upsert(mapEventData(eventData), {
        onConflict: "source_id",
      })
      .select();
    console.log("🚀 ~ supabaseEvent ~ supabaseEvent:", supabaseEvent);

    return res.status(200).json({
      success: true,
      data: eventData,
      message: "Event added successfully",
    });
  } catch (error) {
    console.error("Error adding event:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to add event",
    });
  }
}

function mapEventData(eventData: EventData): Omit<EventFromDB, "id"> {
  return {
    name: eventData.name,
    description: eventData.description,
    start_time: new Date(eventData.startTimestamp * 1000).toISOString(),
    end_time: eventData.endTimestamp
      ? new Date(eventData.endTimestamp * 1000).toISOString()
      : undefined,
    source_id: eventData.id,
    cover_photo: eventData.photo?.imageUri,
    location: eventData.location?.name,
    source: "manual",
    is_featured: false,
  };
}
