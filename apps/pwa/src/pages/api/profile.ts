import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { 
  authHeaderSchema, 
  createErrorResponse, 
  userInfoSchema 
} from "../../lib/schemas";

import { PUBLIC_SUPABASE_URL } from 'astro:env/client';
import { SUPABASE_SERVICE_ROLE_KEY } from 'astro:env/server';

const supabaseServiceRole = createClient(
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
);

export const GET: APIRoute = async ({ request }) => {
  try {
    // Validate auth header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return createErrorResponse("Authentication required", 401);
    }
    
    authHeaderSchema.parse(authHeader);
    const token = authHeader.substring(7);

    // Get user info from token
    let userId: string | undefined;
    let userEmail: string | undefined;
    let userName: string | undefined;

    // Check if it's a JWT or opaque token
    const tokenParts = token.split(".");

    if (tokenParts.length === 3) {
      // JWT token - decode it
      try {
        const payload = tokenParts[1];
        const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "==".substring(0, (4 - base64.length % 4) % 4);
        const decoded = atob(padded);
        const tokenPayload = JSON.parse(decoded);

        userId = tokenPayload.sub;
        userEmail = tokenPayload.email;
        userName = tokenPayload.name || tokenPayload.username || undefined;
      } catch (error) {
        console.error("Error decoding JWT token:", error);
      }
    } else {
      // Opaque token - fetch user info from Logto
      try {
        const userinfoResponse = await fetch(
          "https://auth.gocebby.com/oidc/me",
          {
            headers: {
              "Authorization": `Bearer ${token}`,
            },
          },
        );

        if (userinfoResponse.ok) {
          const rawUserInfo = await userinfoResponse.json();
          const userInfo = userInfoSchema.parse(rawUserInfo);
          userId = userInfo.sub;
          userEmail = userInfo.email;
          userName = userInfo.name || userInfo.username || undefined;
        }
      } catch (error) {
        console.error("Error fetching user info from Logto:", error);
      }
    }

    if (!userId || !userEmail) {
      return createErrorResponse("Could not retrieve user information", 400);
    }

    // Get or create profile
    const { data: existingProfile } = await supabaseServiceRole
      .from("profiles")
      .select("*")
      .eq("logto_user_id", userId)
      .single();

    let profile = existingProfile;

    if (!existingProfile) {
      const { data: newProfile, error: createError } = await supabaseServiceRole
        .from("profiles")
        .insert({
          logto_user_id: userId,
          email: userEmail,
          name: userName || userEmail.split("@")[0],
        })
        .select()
        .single();

      if (createError || !newProfile) {
        return createErrorResponse("Failed to create user profile", 500);
      }

      profile = newProfile;
    }

    // Get event statistics
    const now = new Date();

    // Count attended events (checked in)
    const { count: attendedCount } = await supabaseServiceRole
      .from("event_registrations")
      .select("*", { count: 'exact', head: true })
      .eq("profile_id", profile.id)
      .not("checked_in_at", "is", null);

    // Count saved events
    const { count: savedCount } = await supabaseServiceRole
      .from("event_registrations")
      .select("*", { count: 'exact', head: true })
      .eq("profile_id", profile.id)
      .eq("status", "saved");

    // Count active upcoming RSVPs (confirmed registrations for future events)
    const { data: upcomingRegistrations, error: upcomingError } = await supabaseServiceRole
      .from("event_registrations")
      .select(`
        id,
        status,
        events!inner (
          start_time
        )
      `)
      .eq("profile_id", profile.id)
      .not("status", "in", '("cancelled","saved")');

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
