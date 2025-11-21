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

// Use service role client for operations that need to bypass RLS
const supabaseServiceRole = createClient(
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
);

// Validation schemas
const wrappedQuerySchema = z.object({
  year: z.string().optional().default("2025"),
});

interface WrappedStats {
  year: number;
  userName: string;
  userEmail: string;
  totalEventsAttended: number;
  totalHoursLearning: number;
  firstEvent: {
    name: string;
    date: string;
    coverPhoto?: string;
  } | null;
  topCategory: {
    name: string;
    percentage: number;
  } | null;
  topMonth: {
    name: string;
    count: number;
  } | null;
  crowdFavorite: {
    name: string;
    totalAttendees: number;
    coverPhoto?: string;
  } | null;
  percentileRank: number;
  topCommunities: string[];
  longestStreak: number;
  favoriteDay: string;
  newConnections: number;
}

export const GET: APIRoute = async ({ url, request }) => {
  try {
    // Validate query parameters
    const queryParams = wrappedQuerySchema.parse({
      year: url.searchParams.get("year"),
    });
    const year = parseInt(queryParams.year);

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

    // Check if it's a JWT (has 3 parts separated by dots) or opaque token
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
        
        console.log("Decoded JWT token for user:", userId);
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
          
          console.log("Fetched user info from Logto for user:", userId);
        }
      } catch (error) {
        console.error("Error fetching user info from Logto:", error);
      }
    }

    if (!userId || !userEmail) {
      console.error("Failed to get user ID or email from token");
      return createErrorResponse("Could not retrieve user information", 400);
    }

    // Get or create profile
    let { data: profile, error: profileError } = await supabaseServiceRole
      .from("profiles")
      .select("*")
      .eq("logto_user_id", userId)
      .single();

    if (!profile) {
      // Create new profile
      console.log("Creating new profile for user:", userId, "with email:", userEmail);
      
      const { data: newProfile, error: createError } = await supabaseServiceRole
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
        console.error("Profile creation details:", { userId, userEmail, userName });
        
        // Return more detailed error for debugging
        return new Response(
          JSON.stringify({ 
            error: "Failed to create user profile",
            details: createError.message,
            hint: createError.hint,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      profile = newProfile;
      console.log("Successfully created new profile:", profile.id);
    }

    // Calculate date range for the wrapped year
    const startDate = new Date(year, 0, 1); // Jan 1
    const endDate = new Date(year, 11, 31, 23, 59, 59); // Dec 31

    // PHASE 1: Core Data Queries
    
    // Query 1: Get all events the user attended (checked in) during the year
    const { data: attendedEvents, error: eventsError } = await supabaseServiceRole
      .from("event_registrations")
      .select(`
        *,
        events (
          id,
          name,
          start_time,
          end_time,
          cover_photo,
          type,
          accounts (
            name
          )
        )
      `)
      .eq("profile_id", profile.id)
      .not("checked_in_at", "is", null)
      .gte("checked_in_at", startDate.toISOString())
      .lte("checked_in_at", endDate.toISOString());

    if (eventsError) {
      console.error("Events query error:", eventsError);
      return createErrorResponse("Failed to fetch attended events", 500);
    }

    const events = attendedEvents || [];
    const totalEventsAttended = events.length;

    // If user hasn't attended any events, return welcoming data
    if (totalEventsAttended === 0) {
      const wrappedData: WrappedStats = {
        year,
        userName: userName || profile.name || "Friend",
        userEmail: userEmail || profile.email,
        totalEventsAttended: 0,
        totalHoursLearning: 0,
        firstEvent: null,
        topCategory: null,
        topMonth: null,
        crowdFavorite: null,
        percentileRank: 0,
        topCommunities: [],
        longestStreak: 0,
        favoriteDay: "Saturday",
        newConnections: 0,
      };

      return new Response(JSON.stringify(wrappedData), {
        status: 200,
        headers: { 
          "Content-Type": "application/json",
          "Cache-Control": "private, max-age=60", // Short cache for zero events
        },
      });
    }

    // Query 2: Calculate total hours spent learning
    let totalHoursLearning = 0;
    events.forEach((reg: any) => {
      if (reg.events?.start_time && reg.events?.end_time) {
        const start = new Date(reg.events.start_time);
        const end = new Date(reg.events.end_time);
        const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        totalHoursLearning += hours;
      }
    });
    totalHoursLearning = Math.round(totalHoursLearning);

    // Query 3: Find first event attended
    const sortedEvents = [...events].sort((a: any, b: any) => {
      const aTime = new Date(a.events?.start_time || 0).getTime();
      const bTime = new Date(b.events?.start_time || 0).getTime();
      return aTime - bTime;
    });
    
    const firstEventReg = sortedEvents[0];
    const firstEvent = firstEventReg?.events ? {
      name: firstEventReg.events.name,
      date: new Date(firstEventReg.events.start_time).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }),
      coverPhoto: firstEventReg.events.cover_photo || undefined,
    } : null;

    // Query 4: Calculate top category (Tech Stack Focus)
    const categoryCount: Record<string, number> = {};
    events.forEach((reg: any) => {
      const category = reg.events?.type || "General";
      categoryCount[category] = (categoryCount[category] || 0) + 1;
    });
    
    const topCategoryEntry = Object.entries(categoryCount).sort((a, b) => b[1] - a[1])[0];
    const topCategory = topCategoryEntry ? {
      name: topCategoryEntry[0],
      percentage: Math.round((topCategoryEntry[1] / totalEventsAttended) * 100),
    } : null;

    // Query 5: Calculate top month for attendance
    const monthCount: Record<number, number> = {};
    events.forEach((reg: any) => {
      if (reg.events?.start_time) {
        const month = new Date(reg.events.start_time).getMonth();
        monthCount[month] = (monthCount[month] || 0) + 1;
      }
    });
    
    const topMonthEntry = Object.entries(monthCount).sort((a, b) => b[1] - a[1])[0];
    const topMonth = topMonthEntry ? {
      name: new Date(year, parseInt(topMonthEntry[0]), 1).toLocaleDateString('en-US', { month: 'long' }),
      count: topMonthEntry[1],
    } : null;

    // Calculate favorite day of week
    const dayCount: Record<number, number> = {};
    events.forEach((reg: any) => {
      if (reg.events?.start_time) {
        const day = new Date(reg.events.start_time).getDay();
        dayCount[day] = (dayCount[day] || 0) + 1;
      }
    });
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const topDayEntry = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0];
    const favoriteDay = topDayEntry ? dayNames[parseInt(topDayEntry[0])] : "Saturday";

    // Calculate longest streak of consecutive days
    const attendanceDates = events
      .filter((reg: any) => reg.events?.start_time)
      .map((reg: any) => {
        const date = new Date(reg.events.start_time);
        return date.toISOString().split('T')[0]; // YYYY-MM-DD format
      })
      .sort();
    
    const uniqueDates = [...new Set(attendanceDates)];
    let longestStreak = 0;
    let currentStreak = 1;
    
    for (let i = 1; i < uniqueDates.length; i++) {
      const prevDate = new Date(uniqueDates[i - 1]);
      const currDate = new Date(uniqueDates[i]);
      const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        currentStreak++;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, currentStreak);

    // Calculate top communities (organizers)
    const communityCount: Record<string, number> = {};
    events.forEach((reg: any) => {
      const community = reg.events?.accounts?.name || "Community";
      communityCount[community] = (communityCount[community] || 0) + 1;
    });
    
    const topCommunities = Object.entries(communityCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);

    // PHASE 2: Advanced Logic & Storytelling

    // Query 6: Calculate percentile rank (Top X% of attendees)
    const { data: allUserCounts, error: percentileError } = await supabaseServiceRole
      .from("event_registrations")
      .select("profile_id")
      .not("checked_in_at", "is", null)
      .gte("checked_in_at", startDate.toISOString())
      .lte("checked_in_at", endDate.toISOString());

    let percentileRank = 0;
    if (!percentileError && allUserCounts) {
      const userEventCounts: Record<string, number> = {};
      allUserCounts.forEach((reg: any) => {
        userEventCounts[reg.profile_id] = (userEventCounts[reg.profile_id] || 0) + 1;
      });
      
      const counts = Object.values(userEventCounts);
      const usersWithFewerEvents = counts.filter(count => count < totalEventsAttended).length;
      percentileRank = Math.round((usersWithFewerEvents / counts.length) * 100);
    }

    // Query 7: Find crowd favorite (event with highest total attendance that user attended)
    let crowdFavorite = null;
    const eventIds = events.map((reg: any) => reg.events?.id).filter(Boolean);
    
    if (eventIds.length > 0) {
      const { data: eventAttendance, error: crowdError } = await supabaseServiceRole
        .from("event_registrations")
        .select("event_id")
        .in("event_id", eventIds)
        .not("checked_in_at", "is", null);

      if (!crowdError && eventAttendance) {
        const eventCounts: Record<string, number> = {};
        eventAttendance.forEach((reg: any) => {
          eventCounts[reg.event_id] = (eventCounts[reg.event_id] || 0) + 1;
        });
        
        const topEventId = Object.entries(eventCounts).sort((a, b) => b[1] - a[1])[0];
        if (topEventId) {
          const topEvent = events.find((reg: any) => reg.events?.id === topEventId[0]);
          if (topEvent?.events) {
            crowdFavorite = {
              name: topEvent.events.name,
              totalAttendees: topEventId[1],
              coverPhoto: topEvent.events.cover_photo || undefined,
            };
          }
        }
      }
    }

    // Calculate new connections (unique events attended as a proxy)
    const newConnections = totalEventsAttended * 4; // Rough estimate: 4 new connections per event

    // Assemble final wrapped data
    const wrappedData: WrappedStats = {
      year,
      userName: userName || profile.name || "Tech Enthusiast",
      userEmail: userEmail || profile.email,
      totalEventsAttended,
      totalHoursLearning,
      firstEvent,
      topCategory,
      topMonth,
      crowdFavorite,
      percentileRank,
      topCommunities,
      longestStreak,
      favoriteDay,
      newConnections,
    };

    return new Response(JSON.stringify(wrappedData), {
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=300", // Cache for 5 minutes
      },
    });

  } catch (error) {
    console.error("Wrapped data API error:", error);
    
    if (error instanceof z.ZodError) {
      return createErrorResponse("Invalid request parameters", 400);
    }
    
    return createErrorResponse("Internal server error", 500);
  }
};
