import createClient from "@/utils/supabase/api";
import { parseISO } from "date-fns";
import { addHours } from "date-fns";
import icalendar, { ICalEventData } from "ical-generator";
import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const filename = "calendar.ics";

  const supabase = createClient(req, res);
  const { data, error } = await supabase
    .from("events")
    .select("*");

  if (error) {
    return res.status(500).json({ error: "Unable to generate calendar!" });
  }

  const events: ICalEventData[] = data?.map((event) => ({
    start: parseISO(event.start_time),
    end: event?.end_time
      ? parseISO(event.end_time)
      : addHours(parseISO(event.start_time), 4),
    summary: event.name,
    description: event.description,
    url: `https://www.facebook.com/events/${event.id}`,
  }));

  try {
    const calendar = icalendar({
      prodId: "//cebevents//calendar//EN",
      events,
    });

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.status(200).send(calendar.toString());
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), { status: 500 });
  }
}
