import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

// Use service role client for operations that need to bypass RLS
const supabaseServiceRole = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL || "",
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY || "",
);

// Generate a unique QR code ID without crypto module
function generateQRCodeId(eventId: string, profileId: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  // Create a unique ID by combining event ID, profile ID, timestamp, and random string
  const uniqueString = `${eventId.slice(0, 4)}-${
    profileId.slice(0, 4)
  }-${timestamp}-${random}`;
  // Simple hash-like transformation for consistency
  return uniqueString.toUpperCase().replace(/-/g, "").slice(0, 16);
}

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

    // Get user info from token or Logto
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
        userName = tokenPayload.name || tokenPayload.username;
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
          userEmail = userInfo.email;
          userName = userInfo.name || userInfo.username;
        }
      } catch (error) {
        console.error("Error fetching user info:", error);
      }
    }

    if (!userId || !userEmail) {
      return new Response(
        JSON.stringify({ error: "Could not retrieve user information" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Check if profile exists, create if not
    let { data: profile, error: profileError } = await supabaseServiceRole
      .from("profiles")
      .select("*")
      .eq("logto_user_id", userId)
      .single();

    if (!profile) {
      // Create new profile
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
        return new Response(
          JSON.stringify({ error: "Failed to create user profile" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      profile = newProfile;
    }

    // Check if already registered for this event (excluding cancelled registrations)
    const { data: existingReg } = await supabaseServiceRole
      .from("event_registrations")
      .select("*")
      .eq("event_id", eventId)
      .eq("profile_id", profile.id)
      .neq("status", "cancelled")
      .single();

    if (existingReg) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "You are already registered for this event",
          registration: existingReg,
          qrCodeId: existingReg.qr_code_id,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Generate unique QR code ID
    const qrCodeId = generateQRCodeId(eventId, profile.id);

    // Create new registration
    const { data: registration, error: regError } = await supabaseServiceRole
      .from("event_registrations")
      .insert({
        event_id: eventId,
        email: userEmail,
        name: userName || "Guest",
        profile_id: profile.id,
        status: "confirmed",
        qr_code_id: qrCodeId,
        registered_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        type: "online",
      })
      .select()
      .single();

    if (regError) {
      console.error("Registration error:", regError);
      return new Response(
        JSON.stringify({ error: "Failed to create registration" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        registration,
        profile,
        qrCodeId,
        message: "Registration successful!",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("RSVP API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// GET endpoint to retrieve user's registration for an event
export const GET: APIRoute = async ({ url, request }) => {
  try {
    const eventId = url.searchParams.get("eventId");

    if (!eventId) {
      return new Response(JSON.stringify({ error: "Event ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get auth token
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

    // First get the user's profile
    console.log("🚀 ~ GET ~ userId:", userId);
    const { data: profile } = await supabaseServiceRole
      .from("profiles")
      .select("id")
      .eq("logto_user_id", userId)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ hasRegistered: false }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    console.log("🚀 ~ GET ~ profile:", profile);

    // Get only essential registration data for this specific user (excluding cancelled)
    const { data, error } = await supabaseServiceRole
      .from("event_registrations")
      .select(`
        id,
        qr_code_id,
        status,
        checked_in_at
      `)
      .eq("event_id", eventId)
      .eq("profile_id", profile.id)
      .neq("status", "cancelled")
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ hasRegistered: false }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        hasRegistered: true,
        qrCodeId: data.qr_code_id,
        registrationId: data.id,
        status: data.status,
        checkedInAt: data.checked_in_at,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Get registration error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
