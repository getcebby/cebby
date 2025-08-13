import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { 
  walkinRegistrationSchema, 
  authHeaderSchema, 
  createValidationErrorResponse, 
  createErrorResponse, 
  createSuccessResponse 
} from "../../lib/schemas";

// Use service role client for operations that need to bypass RLS
const supabaseServiceRole = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL || "",
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY || "",
);

// Generate a unique QR code ID
function generateQRCodeId(eventId: string | number, timestamp: number): string {
  const random = Math.random().toString(36).substring(2, 8);
  const eventIdStr = String(eventId);
  return `WALKIN-${eventIdStr.slice(0, 4)}-${timestamp}-${random}`.toUpperCase();
}

export const POST: APIRoute = async ({ request }) => {
  try {
    // Validate request body
    const rawBody = await request.json();
    const validatedBody = walkinRegistrationSchema.parse(rawBody);
    const { eventId, name, email, phone, checkInImmediately } = validatedBody;
    
    // Ensure eventId is a string
    const eventIdStr = String(eventId);

    // Validate auth header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return createErrorResponse("Authentication required", 401);
    }
    
    authHeaderSchema.parse(authHeader);

    // Check if email already exists in profiles (if email provided)
    let profile = null;
    if (email) {
      const { data: existingProfile } = await supabaseServiceRole
        .from("profiles")
        .select("*")
        .eq("email", email)
        .single();
      
      profile = existingProfile;
    }

    // If no profile exists and email provided, create one
    if (!profile && email) {
      const { data: newProfile, error: profileError } = await supabaseServiceRole
        .from("profiles")
        .insert({
          logto_user_id: `walkin_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          email,
          name,
        })
        .select()
        .single();

      if (!profileError) {
        profile = newProfile;
      }
    }

    // Check if already registered (if profile exists, excluding cancelled registrations)
    if (profile) {
      const { data: existingReg } = await supabaseServiceRole
        .from("event_registrations")
        .select("*")
        .eq("event_id", eventIdStr)
        .eq("profile_id", profile.id)
        .neq("status", "cancelled")
        .single();

      if (existingReg) {
        return createSuccessResponse({
          success: false,
          alreadyRegistered: true,
          message: "This person is already registered for the event",
          registration: existingReg,
        });
      }
    }

    // Generate unique QR code
    const timestamp = Date.now();
    const qrCodeId = generateQRCodeId(eventIdStr, timestamp);

    // Create registration
    const registrationData: any = {
      event_id: eventIdStr,
      name,
      email: email || null,
      status: "walkin",
      qr_code_id: qrCodeId,
      registered_at: new Date().toISOString(),
      phone: phone || null,
      type: "walk_in",
    };

    // Add profile_id if we have a profile
    if (profile) {
      registrationData.profile_id = profile.id;
    }

    // If checking in immediately, add check-in data
    if (checkInImmediately) {
      registrationData.checked_in_at = new Date().toISOString();
      registrationData.check_in_method = "manual";
    }

    const { data: registration, error: regError } = await supabaseServiceRole
      .from("event_registrations")
      .insert(registrationData)
      .select()
      .single();

    if (regError) {
      console.error("Registration error:", regError);
      return createErrorResponse("Failed to create registration");
    }

    return createSuccessResponse({
      success: true,
      registration,
      qrCodeId,
      message: checkInImmediately 
        ? "Walk-in registered and checked in successfully!" 
        : "Walk-in registered successfully!",
      checkedIn: checkInImmediately,
    });
  } catch (error) {
    console.error("Walk-in registration API error:", error);
    
    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return createValidationErrorResponse(error);
    }
    
    return createErrorResponse("Internal server error");
  }
};