import "edge_runtime";
import {
  supabase,
  supabaseKey,
  supabaseUrl,
} from "../_shared/supabaseClient.ts";
import type { Tables } from "../_shared/database.types.ts";

Deno.serve(async () => {
  try {
    console.log("Fetching accounts from the database...");
    const { data: accounts, error } = await supabase.from("accounts").select(
      "*",
    );

    if (error) {
      throw new Error(`Error fetching accounts: ${error.message}`);
    }

    console.log(`Fetched ${accounts.length} accounts from the database.`);

    const fetchPromises = accounts.map((account: Tables<"accounts">) => {
      console.log(`Calling function for account ${account.id}...`);
      return fetch(
        `${supabaseUrl}/functions/v1/retrieve-and-sync-to-db-events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify(account),
        },
      )
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              `Error calling function for account ${account.id}: ${response.statusText}`,
            );
          }
          console.log(
            `Successfully called function for account ${account.id}.`,
          );
        })
        .catch((error) => {
          console.error(
            `Error calling function for account ${account.id}:`,
            error,
          );
        });
    });

    Promise.allSettled(fetchPromises);

    const data = {
      message:
        `Successfully called functions to sync events to db with ${accounts.length} accounts`,
    };

    console.log(data.message);

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in Deno.serve:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});
