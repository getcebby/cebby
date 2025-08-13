// Supabase Edge Function for processing email confirmation jobs
// This function will be called by pg_cron every minute to process queued emails

import { createEmailTemplate } from "../shared/templates/event-registration-confirmation.ts";
import { processQueueMessages } from "@service/core/supabase/shared/queue.ts";
import { sendEmail } from "../shared/mailer.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase } from "@service/core/supabase/shared/client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface EmailJob {
  type: "registration_confirmation";
  registration_id: string;
  event_id: number;
  timestamp: number;
}

interface EventDetails {
  id: number;
  name: string;
  description: string | null;
  start_time: string;
  location: string | null;
  slug: string;
}

interface RegistrationDetails {
  id: string;
  event_id: number;
  email: string;
  name: string;
  status: string;
  verification_token: string | null;
  registered_at: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("🔄 Processing email queue...");

    await processQueueMessages<EmailJob>(
      "email-event_registrations-confirmation",
      processEmailJob,
      10, // max messages
      30, // visibility timeout
    );

    console.log("✅ Email queue processing completed");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Email queue processed successfully",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Email processor error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

async function processEmailJob(job: EmailJob): Promise<void> {
  console.log(`Processing job for registration ${job.registration_id}`);

  // Validate job type
  if (job.type !== "registration_confirmation") {
    throw new Error(`Unknown job type: ${job.type}`);
  }

  // Get registration details
  const { data: registration, error: regError } = await supabase
    .from("event_registrations")
    .select(
      "id, event_id, email, name, status, verification_token, registered_at",
    )
    .eq("id", job.registration_id)
    .single();

  if (regError || !registration) {
    throw new Error(
      `Registration ${job.registration_id} not found: ${regError}`,
    );
  }

  // Get event details
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, name, description, start_time, location, slug")
    .eq("id", job.event_id)
    .single();

  if (eventError || !event) {
    throw new Error(`Event ${job.event_id} not found: ${eventError}`);
  }

  // Send confirmation email
  const emailSent = await sendRegistrationConfirmation(registration, event);

  if (!emailSent) {
    throw new Error("Failed to send email");
  }

  console.log(`✅ Email sent to ${registration.email} for event ${event.name}`);
}

async function sendRegistrationConfirmation(
  registration: RegistrationDetails,
  event: EventDetails,
): Promise<boolean> {
  const baseUrl = Deno.env.get("BASE_URL") || "https://www.getcebby.com";

  const eventDate = new Date(event.start_time).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const eventUrl = `${baseUrl}/events/${event.slug}`;

  // Create beautiful email content using our template
  const { html: htmlContent, text: textContent } = createEmailTemplate(
    registration,
    event,
    eventDate,
    eventUrl,
  );

  // Send email using the shared mailer
  const result = await sendEmail({
    to: [{
      address: registration.email,
      name: registration.name,
    }],
    subject: `✅ Registration Confirmed: ${event.name} | cebby`,
    htmlbody: htmlContent,
    textbody: textContent,
  });

  return result.success;
}
