import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Database } from "./database.types.ts";

const isLocal = Deno.env.get("SUPABASE_URL")?.includes("localhost") || false;
console.log("🚀 ~ isLocal:", isLocal);

const localSecretKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
export const supabaseUrl = isLocal
  ? "http://127.0.0.1:54321"
  : Deno.env.get("SUPABASE_URL");
export const supabaseKey = isLocal
  ? localSecretKey
  : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    `Supabase URL or Key is missing: ${supabaseUrl}, ${supabaseKey}`,
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
console.log("🚀 ~ supabase:", supabase);
