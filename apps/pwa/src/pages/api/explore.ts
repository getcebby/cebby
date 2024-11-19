import type { APIRoute } from "astro";
import { supabase } from "../../lib/supabase";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const location = url.searchParams.get("location");
  const filter = url.searchParams.get("filter");
  const search = url.searchParams.get("q");
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = 12;

  try {
    let queryBuilder = supabase.from("events").select("*", { count: "exact" });

    // Apply search filter if query exists
    if (search) {
      queryBuilder = queryBuilder.or(
        `title.ilike.%${search}%, description.ilike.%${search}%`
      );
    }

    // Apply category filter
    if (category) {
      queryBuilder = queryBuilder.eq("category_id", category);
    }

    // Apply location filter
    if (location) {
      queryBuilder = queryBuilder.eq("location", location);
    }

    // Apply quick filters
    if (filter) {
      const now = new Date();
      switch (filter) {
        case "weekend":
          // Get next weekend dates
          const friday = new Date(now);
          friday.setDate(friday.getDate() + (5 - friday.getDay()));
          const sunday = new Date(friday);
          sunday.setDate(sunday.getDate() + 2);

          queryBuilder = queryBuilder
            .gte("start_time", friday.toISOString())
            .lt("start_time", sunday.toISOString());
          break;

        case "free":
          queryBuilder = queryBuilder.eq("is_free", true);
          break;

        case "online":
          queryBuilder = queryBuilder.eq("is_online", true);
          break;

        case "near":
          // Implement location-based filtering
          break;
      }
    }

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    queryBuilder = queryBuilder
      .range(from, to)
      .order("start_time", { ascending: true });

    const { data: events, error, count } = await queryBuilder;

    if (error) throw error;

    return new Response(JSON.stringify({ events, count }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Explore error:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch events" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
};
