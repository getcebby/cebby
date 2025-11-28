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
  profileId: z.string().optional(),
});

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
  // New fields for better UX
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
    let profile: any = null;

    if (!requestedProfileId) {
      // Validate auth header for private requests
      const authHeader = request.headers.get("Authorization");
      if (!authHeader) {
        return createErrorResponse("Authentication required", 401);
      }
      
      authHeaderSchema.parse(authHeader);
      const token = authHeader.substring(7);

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

      // Get or create profile tied to authenticated user
      const { data: existingProfile } = await supabaseServiceRole
        .from("profiles")
        .select("*")
        .eq("logto_user_id", userId)
        .single();

      if (existingProfile) {
        profile = existingProfile;
      } else {
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

        if (createError || !newProfile) {
          console.error("Error creating profile:", createError);
          console.error("Profile creation details:", { userId, userEmail, userName });
          
          // Return more detailed error for debugging
          return new Response(
            JSON.stringify({ 
              error: "Failed to create user profile",
              details: createError?.message,
              hint: createError?.hint,
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
    } else {
      const { data: publicProfile, error: publicProfileError } = await supabaseServiceRole
        .from("profiles")
        .select("*")
        .eq("id", requestedProfileId)
        .single();

      if (publicProfileError || !publicProfile) {
        console.error("Profile lookup failed for public wrapped view:", publicProfileError);
        return createErrorResponse("Profile not found", 404);
      }

      profile = publicProfile;
      userId = publicProfile.logto_user_id || undefined;
      userEmail = publicProfile.email || undefined;
      userName = publicProfile.name || publicProfile.email?.split("@")[0] || undefined;
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
    
    // Debug: Log event locations
    console.log("Events location debug:", events.map((e: any) => ({
      name: e.events?.name,
      location: e.events?.location,
      location_details: e.events?.location_details,
      type: e.events?.type
    })));
    
    // Debug: Log first event in full
    if (events.length > 0) {
      console.log("First event full data:", JSON.stringify(events[0].events, null, 2));
    }

    // If user hasn't attended any events, return welcoming data
    if (totalEventsAttended === 0) {
      const wrappedData: WrappedStats = {
        year,
        userName: userName || profile.name || "Friend",
        userEmail: userEmail || profile.email,
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

    // Build all events array with photos and details
    const allEvents = events.map((reg: any) => {
      // Extract location from location field or location_details JSON
      let location = reg.events?.location;
      
      // Debug log to see actual values
      console.log('Event location data:', {
        name: reg.events?.name,
        location: reg.events?.location,
        locationDetails: reg.events?.location_details,
        locationIsNull: reg.events?.location === null,
        locationIsEmpty: reg.events?.location === '',
        locationIsUndefined: reg.events?.location === undefined,
        locationIsOnline: reg.events?.location === 'Online'
      });
      
      // Prefer location_details over generic "Online" text, or if location is empty
      const shouldCheckLocationDetails = 
        !location || 
        location.trim() === '' || 
        location.toLowerCase() === 'online';
      
      if (shouldCheckLocationDetails && reg.events?.location_details) {
        try {
          const locationDetails = typeof reg.events.location_details === 'string' 
            ? JSON.parse(reg.events.location_details) 
            : reg.events.location_details;
          
          const detailsLocation = locationDetails?.name || locationDetails?.address;
          if (detailsLocation && detailsLocation.trim() !== '') {
            location = detailsLocation;
            console.log('Using location from location_details:', location);
          } else if (!location || location.trim() === '') {
            location = 'TBA';
          }
        } catch (e) {
          console.log('Failed to parse location_details:', e);
          if (!location || location.trim() === '') {
            location = 'TBA';
          }
        }
      } else if (!location || location.trim() === '') {
        location = 'TBA';
      }
      
      return {
        name: reg.events?.name || 'Event',
        date: reg.events?.start_time ? new Date(reg.events.start_time).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }) : '',
        coverPhoto: reg.events?.cover_photo || undefined,
        location,
        organizer: reg.events?.accounts?.name || undefined,
      };
    }).filter((e: any) => e.name);

    // Calculate location diversity
    const locationCount: Record<string, number> = {};
    events.forEach((reg: any) => {
      // Extract location from location field or location_details JSON
      let location = reg.events?.location;
      
      // Prefer location_details over generic "Online" text, or if location is empty
      const shouldCheckLocationDetails = 
        !location || 
        location.trim() === '' || 
        location.toLowerCase() === 'online';
      
      if (shouldCheckLocationDetails && reg.events?.location_details) {
        try {
          const locationDetails = typeof reg.events.location_details === 'string' 
            ? JSON.parse(reg.events.location_details) 
            : reg.events.location_details;
          
          const detailsLocation = locationDetails?.name || locationDetails?.address;
          if (detailsLocation && detailsLocation.trim() !== '') {
            location = detailsLocation;
          } else if (!location || location.trim() === '') {
            location = 'TBA';
          }
        } catch (e) {
          if (!location || location.trim() === '') {
            location = 'TBA';
          }
        }
      } else if (!location || location.trim() === '') {
        location = 'TBA';
      }
      
      locationCount[location] = (locationCount[location] || 0) + 1;
    });
    
    const topLocations = Object.entries(locationCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([location, count]) => ({ location, count }));
    
    const uniqueLocations = Object.keys(locationCount).length;

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
    
    console.log("Crowd Favorite Debug - Event IDs:", eventIds);
    
    if (eventIds.length > 0) {
      // Get total registration counts for all events the user attended
      const { data: eventCounts, error: crowdError } = await supabaseServiceRole
        .from("event_registrations")
        .select("event_id")
        .in("event_id", eventIds)
        .not("checked_in_at", "is", null);

      console.log("Crowd Favorite Debug - Query result:", {
        error: crowdError,
        countsLength: eventCounts?.length,
        sample: eventCounts?.slice(0, 3)
      });

      if (!crowdError && eventCounts) {
        // Count attendees per event
        const counts: Record<string, number> = {};
        eventCounts.forEach((reg: any) => {
          counts[reg.event_id] = (counts[reg.event_id] || 0) + 1;
        });
        
        console.log("Crowd Favorite Debug - Attendance counts:", counts);
        
        // Find event with max attendees
        const sortedEvents = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        
        console.log("Crowd Favorite Debug - Sorted events:", sortedEvents.slice(0, 3));
        
        if (sortedEvents.length > 0) {
          const [topEventId, topCount] = sortedEvents[0];
          // Convert string ID back to number for comparison
          const topEventIdNum = parseInt(topEventId);
          const topEventDetails = events.find((reg: any) => reg.events?.id === topEventIdNum);
          
          console.log("Crowd Favorite Debug - Top event found:", {
            id: topEventId,
            idNum: topEventIdNum,
            count: topCount,
            hasDetails: !!topEventDetails,
            name: topEventDetails?.events?.name
          });
          
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

    console.log("Crowd Favorite Final:", crowdFavorite);

    // Calculate new connections: total participants across all events attended (excluding self)
    let newConnections = 0;
    if (eventIds.length > 0) {
      // Get all checked-in registrations for events the user attended
      const { data: allParticipants, error: participantsError } = await supabaseServiceRole
        .from("event_registrations")
        .select("event_id")
        .in("event_id", eventIds)
        .not("checked_in_at", "is", null);

      if (!participantsError && allParticipants) {
        // Count total participants across all events, then subtract the user's own attendance
        newConnections = allParticipants.length - totalEventsAttended;
        console.log("New Connections Calculation:", {
          totalParticipants: allParticipants.length,
          userAttended: totalEventsAttended,
          newConnections
        });
      }
    }

    // Assemble final wrapped data
    const wrappedData: WrappedStats = {
      year,
      userName: userName || profile.name || "Tech Enthusiast",
      userEmail: userEmail || profile.email,
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

    console.log("Wrapped data assembled:", {
      totalEvents: totalEventsAttended,
      crowdFavorite: crowdFavorite?.name || 'none',
      allEventsCount: allEvents.length,
      locations: uniqueLocations
    });

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
