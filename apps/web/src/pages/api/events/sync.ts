import createClient from "@/utils/supabase/api";
import type { NextApiRequest, NextApiResponse } from "next";
import { fetchEvent } from "@/utils/fetchEvent";
import { findJsonInString } from "@/utils/json";
import axios from "axios";

type Data = {
  message?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== "POST") {
    return res.status(400).json({ message: "Method NOT allowed!" });
  }

  try {
    const supabase = createClient(req, res);
    const { data: fbPages } = await supabase
      .from("facebook_pages")
      .select("*")
      .eq("is_active", true);

    console.log("🚀 ~ fbPages:", fbPages);
    if (!fbPages) {
      return res.status(404).json({ message: "No Facebook pages found!" });
    }

    const urls: string[] = await getUrlsFromFbPages(fbPages);
    if (urls.length === 0) {
      return res.status(404).json({ message: "No events found" });
    }

    const uniqueUrls = Array.from(new Set(urls.flat()))?.filter(Boolean);
    console.log("🚀 ~ uniqueUrls:", uniqueUrls);

    for (const url of uniqueUrls) {
      // Send a request to add the event to the database
      axios
        .post(`${process.env.NEXT_PUBLIC_API_URL}/api/events/add_by_url`, {
          url,
        })
        .then(() => console.log(`Initiated adding event from ${url}`));
    }

    res.status(200).json({ message: "Synced events!" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error syncing events" });
  }
}

interface FbPage {
  id: string;
  username: string;
  url: string;
}

async function getUrlsFromFbPages(fbPages: FbPage[]) {
  return Promise.all(
    fbPages.map(async (page) => {
      const data = await fetchEvent(page.url);
      const { jsonData } = findJsonInString(data, "pageItems");
      console.log("🚀 ~ jsonData:", jsonData?.edges);

      const urls = jsonData?.edges?.map(
        (item: { node: { url: string } }) => item.node.url
      );
      return urls;
    })
  );
}
