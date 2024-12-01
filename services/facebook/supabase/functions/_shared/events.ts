import "@supabase/functions-js/edge-runtime";
import { supabase } from "./supabaseClient.ts";
import { Tables } from "./database.types.ts";

export const saveEventsToDB = async (events: Tables<"events">[]) => {
  const { data, error } = await supabase.from("events").upsert(events, {
    onConflict: "source_id",
  });

  return {
    data,
    error,
  };
};

export const getEventsFromDB = async () => {
  const { data, error } = await supabase.from("events").select("*");

  if (error) {
    console.error(error);
  } else {
    console.log(data);
  }
};

export async function retrieveEventsFromFacebook(
  url: string,
): Promise<Tables<"events">[]> {
  const allEvents = [];

  try {
    const response = await fetch(url, {
      method: "GET",
    });
    const result = await response.json();
    allEvents.push(...result.data);

    if (result?.paging?.next) {
      const nextEvents = await retrieveEventsFromFacebook(result.paging.next);
      allEvents.push(...nextEvents);
    }
  } catch (error) {
    if (error instanceof Response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.log(await error.json());
      console.log(error.status);
      console.log(error.headers);
    } else if (error instanceof Error) {
      // Something happened in setting up the request that triggered an Error
      console.log("Error", error.message);
    } else {
      console.log("Unknown error", error);
    }
  }

  return allEvents;
}
