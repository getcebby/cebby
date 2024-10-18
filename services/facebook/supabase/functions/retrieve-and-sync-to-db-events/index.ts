import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  retrieveEventsFromFacebook,
  saveEventsToDB,
} from "../_shared/events.ts";

Deno.serve(async (req) => {
  const account = await req.json();
  const { account_id, access_token } = account;

  const pageId = account_id;
  const fields =
    `id,name,cover,description,created_time,place,start_time,end_time`;
  const url =
    `https://graph.facebook.com/v21.0/${pageId}/events?fields=${fields}&access_token=${access_token}&format=json&method=get`;
  console.log("🚀 ~ Deno.serve ~ url:", url);

  const events = await retrieveEventsFromFacebook(url);

  const mappedEvents = mapEventsToDB(events, account);
  console.log("🚀 ~ Deno.serve ~ mappedEvents:", mappedEvents);

  await saveEventsToDB(mappedEvents).then((result) =>
    console.log("result", result)
  )
    .catch((error) => console.error(error));
  // console.log("🚀 ~ Deno.serve ~ events:", events);

  return new Response(
    JSON.stringify({
      events: events || [],
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
});

export const mapEventsToDB = (events, account) => {
  return events.map((event) => {
    return {
      name: event.name,
      description: event.description,
      start_time: event.start_time,
      end_time: event?.end_time,
      location: event?.place?.name,
      cover_photo: event?.cover?.source,
      source: account.type || "facebook",
      source_id: event.id,
      account_id: account.account_id,
    };
  });
};
