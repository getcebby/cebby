import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { 
  eventCheckinSchema, 
  authHeaderSchema, 
  createValidationErrorResponse, 
  createErrorResponse, 
  createSuccessResponse 
} from "../../lib/schemas";

import { PUBLIC_SUPABASE_URL } from 'astro:env/client';
import { SUPABASE_SERVICE_ROLE_KEY } from 'astro:env/server';

// Use service role client for operations that need to bypass RLS
const supabaseServiceRole = createClient(
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
);

export const POST: APIRoute = async ({ request }) => {
  try {
    // Validate request body
    const rawBody = await request.json();
    const validatedBody = eventCheckinSchema.parse(rawBody);
    const { qrCodeId, eventId } = validatedBody;

    // Verify admin authentication
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return createErrorResponse("Authentication required", 401);
    }
    
    authHeaderSchema.parse(authHeader);

    // Find registration by QR code
    const { data: registration, error: findError } = await supabaseServiceRole
      .from("event_registrations")
      .select(`
        *,
        profiles(*)
      `)
      .eq("qr_code_id", qrCodeId)
      .eq("event_id", eventId)
      .single();

    if (findError || !registration) {
      return createErrorResponse("Invalid QR code or registration not found", 404);
    }

    // Check if registration is cancelled
    if (registration.status === "cancelled") {
      return createSuccessResponse({
        success: false,
        cancelled: true,
        message: "This registration has been cancelled",
        registration: {
          id: registration.id,
          name: registration.profiles?.name || registration.name,
          email: registration.profiles?.email || registration.email,
          cancelledAt: registration.cancelled_at ? new Date(registration.cancelled_at).toLocaleString() : "Unknown",
        },
      });
    }

    // Check if already checked in
    if (registration.checked_in_at) {
      const checkedInTime = new Date(registration.checked_in_at);
      return createSuccessResponse({
        success: false,
        alreadyCheckedIn: true,
        message: "Already checked in",
        registration: {
          id: registration.id,
          name: registration.profiles?.name || registration.name,
          email: registration.profiles?.email || registration.email,
          checkedInAt: checkedInTime.toLocaleString(),
        },
      });
    }

    // Update check-in status
    const { data: updated, error: updateError } = await supabaseServiceRole
      .from("event_registrations")
      .update({
        checked_in_at: new Date().toISOString(),
        check_in_method: "qr_code",
      })
      .eq("id", registration.id)
      .select(`
        *,
        profiles(*)
      `)
      .single();

    if (updateError) {
      console.error("Check-in update error:", updateError);
      return createErrorResponse("Failed to update check-in status");
    }

    return createSuccessResponse({
      success: true,
      message: "Check-in successful!",
      registration: {
        id: updated.id,
        name: updated.profiles?.name || updated.name,
        email: updated.profiles?.email || updated.email,
        checkedInAt: new Date().toLocaleString(),
      },
    });
  } catch (error) {
    console.error("Check-in API error:", error);
    
    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    
    return createErrorResponse("Internal server error");
  }
};

// GET endpoint to get event check-in stats
export const GET: APIRoute = async ({ url }) => {
  try {
    const eventId = url.searchParams.get("eventId");
    
    if (!eventId) {
      return new Response(JSON.stringify({ error: "Event ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get check-in statistics (excluding cancelled registrations)
    const { data: registrations, error } = await supabaseServiceRole
      .from("event_registrations")
      .select(`
        *,
        profiles(name, email)
      `)
      .eq("event_id", eventId)
      .neq("status", "cancelled")
      .order("checked_in_at", { ascending: false });

    if (error) {
      console.error("Stats error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to get statistics" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const totalRegistrations = registrations?.length || 0;
    const checkedIn = registrations?.filter(r => r.checked_in_at).length || 0;
    const pending = totalRegistrations - checkedIn;

    return new Response(
      JSON.stringify({
        stats: {
          total: totalRegistrations,
          checkedIn,
          pending,
          percentage: totalRegistrations > 0 
            ? Math.round((checkedIn / totalRegistrations) * 100) 
            : 0,
        },
        recentCheckIns: registrations
          ?.filter(r => r.checked_in_at)
          .slice(0, 5)
          .map(r => ({
            name: r.profiles?.name || r.name,
            email: r.profiles?.email || r.email,
            checkedInAt: r.checked_in_at,
          })),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Stats API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};