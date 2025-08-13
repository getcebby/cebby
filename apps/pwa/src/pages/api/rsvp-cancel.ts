import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

// Use service role client for operations that need to bypass RLS
const supabaseServiceRole = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL || "",
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY || "",
);

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { eventId } = body;

    if (!eventId) {
      return new Response(JSON.stringify({ error: "Event ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get auth token from header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const token = authHeader.substring(7);

    // Get user info from token
    let userId: string | undefined;

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
          const userInfo = await userinfoResponse.json();
          userId = userInfo.sub;
        }
      } catch (error) {
        console.error("Error fetching user info:", error);
      }
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Could not retrieve user information" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Get user's profile
    const { data: profile } = await supabaseServiceRole
      .from("profiles")
      .select("*")
      .eq("logto_user_id", userId)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // First check if the registration exists and its current status
    const { data: existingRegistration, error: checkError } = await supabaseServiceRole
      .from("event_registrations")
      .select("*")
      .eq("event_id", eventId)
      .eq("profile_id", profile.id)
      .eq("status", "confirmed")
      .single();

    if (checkError || !existingRegistration) {
      return new Response(
        JSON.stringify({ error: "No active registration found to cancel" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Check if user has already checked in
    if (existingRegistration.checked_in_at) {
      return new Response(
        JSON.stringify({ 
          error: "Cannot cancel registration after checking in",
          checkedIn: true,
          checkedInAt: existingRegistration.checked_in_at
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Update the registration to mark it as cancelled
    const { data: cancelledRegistration, error: updateError } = await supabaseServiceRole
      .from("event_registrations")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", existingRegistration.id)
      .select()
      .single();

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to cancel registration" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (!cancelledRegistration) {
      return new Response(
        JSON.stringify({ error: "No active registration found to cancel" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Registration cancelled successfully",
        registration: cancelledRegistration,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Cancel RSVP API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};