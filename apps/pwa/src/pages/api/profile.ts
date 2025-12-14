import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { 
  createErrorResponse
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

    const { userId, userEmail, userName } = userInfo;

    // Create Supabase client with anon key
    // Since RLS is disabled on profiles table, anon key has access
    const supabase = createClient(
      PUBLIC_SUPABASE_URL,
      PUBLIC_SUPABASE_ANON_KEY
    );

    // Get or create profile
    const { data: existingProfile, error: fetchError } = await supabase
      .from("profiles")
      .select("*")
      .eq("logto_user_id", userId)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching profile:", fetchError);
      return createErrorResponse("Failed to fetch user profile", 500);
    }

    let profile = existingProfile;

    if (!existingProfile) {
      const { data: newProfile, error: createError } = await supabase
        .from("profiles")
        .insert({
          logto_user_id: userId,
          email: userEmail,
          name: userName || userEmail.split("@")[0],
        })
        .select()
        .single();

      if (createError) {
        console.error("Error creating profile:", createError);
        return createErrorResponse("Failed to create user profile", 500);
      }

      if (!newProfile) {
        return createErrorResponse("Failed to create user profile", 500);
      }

      profile = newProfile;
    }

    // Get event statistics
    const now = new Date();

    // Fetch all statistics in parallel for better performance
    const [
      { count: attendedCount, error: attendedError },
      { count: savedCount, error: savedError },
      { data: upcomingRegistrations, error: upcomingError }
    ] = await Promise.all([
      // Count attended events (checked in)
      supabase
        .from("event_registrations")
        .select("*", { count: 'exact', head: true })
        .eq("profile_id", profile.id)
        .not("checked_in_at", "is", null),
      
      // Count saved events
      supabase
        .from("event_registrations")
        .select("*", { count: 'exact', head: true })
        .eq("profile_id", profile.id)
        .eq("status", "saved"),
      
      // Count active upcoming RSVPs (confirmed registrations for future events)
      supabase
        .from("event_registrations")
        .select(`
          id,
          status,
          events!inner (
            start_time
          )
        `)
        .eq("profile_id", profile.id)
        .not("status", "in", '("cancelled","saved")')
    ]);

    if (attendedError) {
      console.error("Error counting attended events:", attendedError);
    }

    if (savedError) {
      console.error("Error counting saved events:", savedError);
    }

    if (upcomingError) {
      console.error("Error counting upcoming RSVPs:", upcomingError);
    }

    const rsvpCount = (upcomingRegistrations || []).filter((registration) => {
      const eventsRelation = Array.isArray(registration.events)
        ? registration.events[0]
        : registration.events;
      const startTime = eventsRelation?.start_time;
      if (!startTime) return false;
      return new Date(startTime) >= now;
    }).length;

    const profileData = {
      name: profile.name || userName || "User",
      email: profile.email || userEmail,
      joined: new Date(profile.created_at).toLocaleDateString('en-US', { 
        month: 'long', 
        year: 'numeric' 
      }),
      stats: {
        eventsAttended: attendedCount || 0,
        eventsSaved: savedCount || 0,
        rsvps: rsvpCount,
      },
    };

    return new Response(JSON.stringify(profileData), {
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=60",
      },
    });

  } catch (error) {
    console.error("Profile API error:", error);
    
    if (error instanceof z.ZodError) {
      return createErrorResponse("Invalid request parameters", 400);
    }
    
    return createErrorResponse("Internal server error", 500);
  }
};
