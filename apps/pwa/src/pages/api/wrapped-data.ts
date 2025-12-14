import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createErrorResponse } from "../../lib/schemas";
import { getAuthenticatedUser } from "../../lib/server-auth-utils";
import { extractEventLocation } from "../../lib/event-utils";

import { PUBLIC_SUPABASE_URL } from 'astro:env/client';
import { SUPABASE_SERVICE_ROLE_KEY } from 'astro:env/server';

// Validation schemas
const wrappedQuerySchema = z.object({
  year: z.string().optional().default("2025"),
  profileId: z.string().optional(),
});

// Type definitions
interface Profile {
  id: string;
  logto_user_id?: string;
  email?: string;
  name?: string;
  created_at: string;
}

interface WrappedStats {
  year: number;
  userName: string;
  userEmail: string;
  profileId: string;
  totalEventsAttended: number;
  totalHoursLearning: number;
  firstEvent: {
    name: string;
    date: string;
    coverPhoto?: string;
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
  allEvents: Array<{
    name: string;
    date: string;
    coverPhoto?: string;
    location: string;
    organizer?: string;
  }>;
  topLocations: Array<{
    location: string;
    count: number;
  }>;
  uniqueLocations: number;
}

export const GET: APIRoute = async ({ url, request }) => {
  // Create Supabase client inside handler for serverless compatibility
  const supabase = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Validate query parameters
    const queryParams = wrappedQuerySchema.parse({
      year: url.searchParams.get("year") ?? undefined,
      profileId: url.searchParams.get("profileId") ?? undefined,
    });
    const year = parseInt(queryParams.year);
    const requestedProfileId = queryParams.profileId;

    // Get user info from token
    let userId: string | undefined;
    let userEmail: string | undefined;
    let userName: string | undefined;
    let profile: Profile | null = null;

    if (!requestedProfileId) {
      // Validate auth header for private requests
      const userInfo = await getAuthenticatedUser(request);
      if (!userInfo) {
        return createErrorResponse("Authentication required", 401);
      }

      userId = userInfo.userId;
      userEmail = userInfo.userEmail;
      userName = userInfo.userName;

      // Get or create profile tied to authenticated user
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("logto_user_id", userId)
        .single();

      if (existingProfile) {
        profile = existingProfile;
      } else {
        // Create new profile
        const { data: newProfile, error: createError } = await supabase
          .from("profiles")
          .insert({
            logto_user_id: userId,
            email: userEmail,
            name: userName || userEmail?.split("@")[0],
          })
          .select()
          .single();

        if (createError || !newProfile) {
          console.error("Error creating profile:", createError);
          return createErrorResponse("Failed to create user profile", 500);
        }

        profile = newProfile;
      }
    } else {
      const { data: publicProfile, error: publicProfileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", requestedProfileId)
        .single();

      if (publicProfileError || !publicProfile) {
        return createErrorResponse("Profile not found", 404);
      }

      profile = publicProfile;
      userId = publicProfile.logto_user_id || undefined;
      userEmail = publicProfile.email || undefined;
      userName = publicProfile.name || publicProfile.email?.split("@")[0] || undefined;
    }

    if (!profile) {
      return createErrorResponse("Profile not found", 404);
    }

    // Calculate date range for the wrapped year
    const startDate = new Date(year, 0, 1); // Jan 1
    const endDate = new Date(year, 11, 31, 23, 59, 59); // Dec 31

    // Query: Get all events the user attended (checked in) during the year
    const { data: attendedEvents, error: eventsError } = await supabase
      .from("event_registrations")
      .select(`
        *,
        events (
          id,
          name,
          start_time,
          end_time,
          cover_photo,
          location,
          location_details,
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

    // If user hasn't attended any events, return empty data
    if (totalEventsAttended === 0) {
      const wrappedData: WrappedStats = {
        year,
        userName: userName || profile.name || "Friend",
        userEmail: userEmail || profile.email || "",
        profileId: profile.id,
        totalEventsAttended: 0,
        totalHoursLearning: 0,
        firstEvent: null,
        topMonth: null,
        crowdFavorite: null,
        percentileRank: 0,
        topCommunities: [],
        longestStreak: 0,
        favoriteDay: "Saturday",
        newConnections: 0,
        allEvents: [],
        topLocations: [],
        uniqueLocations: 0,
      };

      return new Response(JSON.stringify(wrappedData), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, max-age=60",
        },
      });
    }

    // Calculate total hours spent learning
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

    // Find first event attended
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

    // Build all events array with photos and details using shared utility
    const allEvents = events.map((reg: any) => ({
      name: reg.events?.name || 'Event',
      date: reg.events?.start_time ? new Date(reg.events.start_time).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }) : '',
      coverPhoto: reg.events?.cover_photo || undefined,
      location: extractEventLocation(reg.events),
      organizer: reg.events?.accounts?.name || undefined,
    })).filter((e: any) => e.name);

    // Calculate location diversity using shared utility
    const locationCount: Record<string, number> = {};
    events.forEach((reg: any) => {
      const location = extractEventLocation(reg.events);
      locationCount[location] = (locationCount[location] || 0) + 1;
    });

    const topLocations = Object.entries(locationCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([location, count]) => ({ location, count }));

    const uniqueLocations = Object.keys(locationCount).length;

    // Calculate top month for attendance
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

    // Calculate percentile rank (Top X% of attendees)
    const { data: allUserCounts, error: percentileError } = await supabase
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

    // Find crowd favorite (event with highest total attendance that user attended)
    let crowdFavorite = null;
    const eventIds = events.map((reg: any) => reg.events?.id).filter(Boolean);

    if (eventIds.length > 0) {
      const { data: eventCounts, error: crowdError } = await supabase
        .from("event_registrations")
        .select("event_id")
        .in("event_id", eventIds)
        .not("checked_in_at", "is", null);

      if (!crowdError && eventCounts) {
        const counts: Record<string, number> = {};
        eventCounts.forEach((reg: any) => {
          counts[reg.event_id] = (counts[reg.event_id] || 0) + 1;
        });

        const sortedByAttendance = Object.entries(counts).sort((a, b) => b[1] - a[1]);

        if (sortedByAttendance.length > 0) {
          const [topEventId, topCount] = sortedByAttendance[0];
          const topEventIdNum = parseInt(topEventId);
          const topEventDetails = events.find((reg: any) => reg.events?.id === topEventIdNum);

          if (topEventDetails?.events) {
            crowdFavorite = {
              name: topEventDetails.events.name,
              totalAttendees: topCount,
              coverPhoto: topEventDetails.events.cover_photo || undefined,
            };
          }
        }
      }
    }

    // Calculate new connections: total participants across all events attended (excluding self)
    let newConnections = 0;
    if (eventIds.length > 0) {
      const { data: allParticipants, error: participantsError } = await supabase
        .from("event_registrations")
        .select("event_id")
        .in("event_id", eventIds)
        .not("checked_in_at", "is", null);

      if (!participantsError && allParticipants) {
        newConnections = allParticipants.length - totalEventsAttended;
      }
    }

    // Assemble final wrapped data
    const wrappedData: WrappedStats = {
      year,
      userName: userName || profile.name || "Tech Enthusiast",
      userEmail: userEmail || profile.email || "",
      profileId: profile.id,
      totalEventsAttended,
      totalHoursLearning,
      firstEvent,
      topMonth,
      crowdFavorite,
      percentileRank,
      topCommunities,
      longestStreak,
      favoriteDay,
      newConnections,
      allEvents,
      topLocations,
      uniqueLocations,
    };

    return new Response(JSON.stringify(wrappedData), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=300",
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
