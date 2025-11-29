import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { 
  createErrorResponse,
  createSuccessResponse 
} from "../../lib/schemas";
import { getAuthenticatedUser } from "../../lib/server-auth-utils";

import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from 'astro:env/client';

export const GET: APIRoute = async ({ request }) => {
  try {
    // Get authenticated user info
    const userInfo = await getAuthenticatedUser(request);
    if (!userInfo) {
      return createErrorResponse("Authentication required", 401);
    }

    const { userId } = userInfo;

    // Create Supabase client with anon key
    // Since RLS is disabled on profiles table, anon key has access
    const supabase = createClient(
      PUBLIC_SUPABASE_URL,
      PUBLIC_SUPABASE_ANON_KEY
    );

    // Get user's profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("logto_user_id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("Error fetching profile:", profileError);
      return createErrorResponse("Failed to fetch profile", 500);
    }

    if (!profile) {
      return createErrorResponse("Profile not found", 404);
    }

    // Fetch all user's event registrations with event details
    const { data: registrations, error: regError } = await supabase
      .from("event_registrations")
      .select(`
        id,
        event_id,
        status,
        checked_in_at,
        registered_at,
        events (
          id,
          name,
          start_time,
          end_time,
          location,
          location_details,
          cover_photo,
          slug,
          accounts (
            name
          )
        )
      `)
      .eq("profile_id", profile.id)
      .neq("status", "cancelled")
      .order("registered_at", { ascending: false });

    if (regError) {
      console.error("Error fetching registrations:", regError);
      return createErrorResponse("Failed to fetch events", 500);
    }

    const now = new Date();
    const upcoming: any[] = [];
    const past: any[] = [];

    (registrations || []).forEach((reg: any) => {
      if (!reg.events) return;
      
      const startTime = new Date(reg.events.start_time);
      const endTime = reg.events.end_time ? new Date(reg.events.end_time) : null;
      
      // Past events: those that have ended (end_time < now) or have no end_time but started more than 6 hours ago
      // Upcoming events: those that haven't started yet (start_time > now)
      if (endTime && endTime < now) {
        past.push(reg);
      } else if (!endTime && startTime < now) {
        // If no end_time, assume event is past if it started more than 6 hours ago
        const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
        if (startTime < sixHoursAgo) {
          past.push(reg);
        } else {
          upcoming.push(reg);
        }
      } else if (startTime >= now) {
        upcoming.push(reg);
      } else {
        // Event has started but not ended yet - consider it upcoming
        upcoming.push(reg);
      }
    });

    // Sort upcoming by nearest first, past by most recent first
    upcoming.sort((a, b) => {
      const aTime = new Date(a.events.start_time).getTime();
      const bTime = new Date(b.events.start_time).getTime();
      return aTime - bTime;
    });

    past.sort((a, b) => {
      const aTime = new Date(a.events.start_time).getTime();
      const bTime = new Date(b.events.start_time).getTime();
      return bTime - aTime; // Reverse for past events
    });

    return new Response(
      JSON.stringify({
        upcoming,
        past,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, max-age=60",
        },
      },
    );

  } catch (error) {
    console.error("My events API error:", error);
    
    if (error instanceof z.ZodError) {
      return createErrorResponse("Invalid request parameters", 400);
    }
    
    return createErrorResponse("Internal server error", 500);
  }
};
