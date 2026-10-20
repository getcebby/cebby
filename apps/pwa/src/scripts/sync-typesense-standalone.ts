import "dotenv/config";

import type { Database } from "@service/core/supabase/shared/database.types.ts";
import {
    EVENT_SEARCH_SELECT,
    type EventSearchDoc,
    type EventSearchRow,
    eventsCollectionSchema,
    eventToSearchDoc,
} from "@service/core/supabase/shared/search-doc.ts";
import Typesense from "typesense";
import { createClient } from "@supabase/supabase-js";

// Load environment variables
const SUPABASE_URL = process.env.SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;
const TYPESENSE_HOST = process.env.TYPESENSE_HOST ||
    process.env.PUBLIC_TYPESENSE_HOST;
const TYPESENSE_PORT = process.env.TYPESENSE_PORT ||
    process.env.PUBLIC_TYPESENSE_PORT || "443";
const TYPESENSE_PROTOCOL = process.env.TYPESENSE_PROTOCOL ||
    process.env.PUBLIC_TYPESENSE_PROTOCOL || "https";
const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY ||
    process.env.TYPESENSE_ADMIN_KEY;

// Validate required environment variables
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
if (!SUPABASE_SERVICE_KEY) {
    throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is required",
    );
}
if (!TYPESENSE_HOST) throw new Error("TYPESENSE_HOST is required");
if (!TYPESENSE_API_KEY) throw new Error("TYPESENSE_API_KEY is required");

console.log("🔧 Configuration:");
console.log(`  Supabase URL: ${SUPABASE_URL}`);
console.log(`  Typesense Host: ${TYPESENSE_HOST}`);
console.log(`  Typesense Port: ${TYPESENSE_PORT}`);
console.log(`  Typesense Protocol: ${TYPESENSE_PROTOCOL}`);

// Initialize clients
const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const typesenseClient = new Typesense.Client({
    nodes: [
        {
            host: TYPESENSE_HOST,
            port: parseInt(TYPESENSE_PORT),
            protocol: TYPESENSE_PROTOCOL as "http" | "https",
        },
    ],
    apiKey: TYPESENSE_API_KEY,
    connectionTimeoutSeconds: 10,
    retryIntervalSeconds: 2,
});

// Test Typesense connection
async function testTypesenseConnection(): Promise<boolean> {
    try {
        console.log("\n🔍 Testing Typesense connection...");
        const health = await typesenseClient.health.retrieve();
        console.log("✅ Typesense server is healthy:", health);
        return true;
    } catch (error: any) {
        console.error("❌ Typesense server is not reachable:", error.message);
        if (error.httpStatus === 503) {
            console.error(
                "   The Typesense server at",
                TYPESENSE_HOST,
                "is unavailable (503).",
            );
            console.error("   Please check:");
            console.error("   1. The Typesense server is running");
            console.error("   2. The host/port configuration is correct");
            console.error("   3. The API key is valid");
        }
        return false;
    }
}

// Create or update the events collection
async function createOrUpdateEventsCollection() {
    try {
        // Check if collection exists
        try {
            const collection = await typesenseClient.collections("events")
                .retrieve();
            console.log("📝 Events collection already exists");
            console.log("   Collection details:", {
                name: collection.name,
                num_documents: collection.num_documents,
                fields: collection.fields?.length,
            });

            // Add fields the schema gained since the collection was created
            // (e.g. city). Typesense can add fields in place; changing or
            // dropping one still needs the drop-and-recreate below.
            const existing = new Set(collection.fields?.map((f) => f.name));
            const missing = eventsCollectionSchema.fields.filter((f) =>
                !existing.has(f.name)
            );
            if (missing.length > 0) {
                console.log(
                    `🧩 Adding fields: ${missing.map((f) => f.name).join(", ")}`,
                );
                await typesenseClient.collections("events").update({
                    fields: missing,
                } as any);
            }

            // Optionally drop and recreate for schema changes
            // Uncomment if you need to update the schema
            // console.log('Dropping existing collection...');
            // await typesenseClient.collections('events').delete();
            // console.log('Creating new collection...');
            // await typesenseClient.collections().create(eventsCollectionSchema as any);
        } catch (error: any) {
            console.log(
                "Collection check error:",
                error.message,
                "Status:",
                error.httpStatus,
            );

            if (
                error.httpStatus === 404 || error.message.includes("Not Found")
            ) {
                console.log("Creating new events collection...");
                try {
                    const result = await typesenseClient.collections().create(
                        eventsCollectionSchema as any,
                    );
                    console.log("✅ Events collection created successfully");
                } catch (createError: any) {
                    console.error(
                        "Failed to create collection:",
                        createError.message,
                    );
                    if (createError.httpBody) {
                        console.error("Error details:", createError.httpBody);
                    }
                    throw createError;
                }
            } else {
                console.error(
                    "Unexpected error checking collection:",
                    error.message,
                );
                throw error;
            }
        }
    } catch (error) {
        console.error("❌ Error managing collection:", error);
        throw error;
    }
}

// Sync all events from Supabase to Typesense
async function syncEventsToTypesense() {
    try {
        console.log("Fetching events from Supabase...");

        // Same select and document builder as the realtime sync-event edge
        // function, so a nightly run can't rewrite fields differently from it
        const { data: events, error } = await supabase
            .from("events")
            .select(EVENT_SEARCH_SELECT)
            .neq("status", "hidden")
            .limit(100_000)
            .order("start_time", { ascending: false });

        if (error) {
            throw new Error(`Supabase error: ${error.message}`);
        }

        if (!events || events.length === 0) {
            console.log("📝 No events found to sync");
            return;
        }

        console.log(`📊 Found ${events.length} events to sync`);

        // Clear existing documents (optional - remove if you want to keep old events)
        try {
            await typesenseClient.collections("events").documents().delete({
                filter_by: "id:!=0",
            });
            console.log("🧹 Cleared existing documents");
        } catch (error: any) {
            if (error.httpStatus !== 404) {
                console.error(
                    "Warning: Could not clear existing documents:",
                    error.message,
                );
            }
        }

        // Transform events for Typesense
        const documents = (events as unknown as EventSearchRow[]).map(
            eventToSearchDoc,
        );

        // Import to Typesense in batches
        const batchSize = 100;
        let synced = 0;
        let failed = 0;

        for (let i = 0; i < documents.length; i += batchSize) {
            const batch = documents.slice(i, i + batchSize);

            try {
                const result = await typesenseClient
                    .collections("events")
                    .documents()
                    .import(batch, { action: "upsert" });

                // Check for any failed imports
                const importResults = result as any[];
                let batchFailed = 0;
                importResults.forEach((r: any, index: number) => {
                    if (!r.success) {
                        batchFailed++;
                        console.error(
                            `  ❌ Document ${batch[index].id}: ${r.error}`,
                        );
                    }
                });

                synced += batch.length - batchFailed;
                failed += batchFailed;
                console.log(
                    `📤 Synced ${synced}/${documents.length} events (${failed} failed)`,
                );
            } catch (batchError: any) {
                console.error(
                    `❌ Error syncing batch ${i}-${i + batch.length}:`,
                    batchError.message,
                );
                failed += batch.length;
            }
        }

        console.log(
            `✅ Sync completed: ${synced} successful, ${failed} failed out of ${documents.length} total`,
        );

        if (failed > 0) {
            throw new Error(`Failed to sync ${failed} events`);
        }
    } catch (error) {
        console.error("❌ Error syncing events:", error);
        throw error;
    }
}

// Test search functionality
async function testSearch() {
    try {
        console.log("\n🔍 Testing search functionality...");

        const testResults = await typesenseClient.collections("events")
            .documents().search({
                q: "*",
                query_by: "name,description,organization",
                per_page: 5,
                sort_by: "start_time:desc",
            });

        console.log(
            `✅ Search test successful! Found ${testResults.found} total results`,
        );

        if (testResults.hits && testResults.hits.length > 0) {
            console.log("📋 Recent events:");
            testResults.hits.forEach((hit, index) => {
                const doc = hit.document as EventSearchDoc;
                const date = new Date(doc.start_time * 1000)
                    .toLocaleDateString();
                console.log(
                    `  ${
                        index + 1
                    }. "${doc.name}" by ${doc.organization} (${date})`,
                );
            });
        }
    } catch (error) {
        console.error("❌ Search test failed:", error);
        throw error;
    }
}

// Main sync function
async function syncTypesense() {
    console.log("🚀 Starting Typesense sync for Cebby...\n");

    try {
        // Test connection first
        const isConnected = await testTypesenseConnection();
        if (!isConnected) {
            console.error(
                "\n⚠️  Cannot proceed without a working Typesense connection.",
            );
            console.error(
                "📝 Note: The Typesense server appears to be down or misconfigured.",
            );
            console.error("    You may need to:");
            console.error("    1. Start your Typesense server if self-hosted");
            console.error(
                "    2. Use Typesense Cloud (https://cloud.typesense.org)",
            );
            console.error(
                "    3. Update your environment variables with correct credentials",
            );
            process.exit(1);
        }

        await createOrUpdateEventsCollection();
        await syncEventsToTypesense();
        await testSearch();

        // Uncomment after setting up once
        // const searchOnlyKey = await setupSearchOnlyKey();
        // console.log(`🔗 Search-only key created: ${searchOnlyKey}`);

        console.log("\n🎉 Typesense sync completed successfully!");
        process.exit(0);
    } catch (error) {
        console.error("\n💀 Sync failed:", error);
        process.exit(1);
    }
}

// Setup search-only key
async function setupSearchOnlyKey() {
    try {
        console.log("\n🔍 Setting up search-only key...");

        const result = await typesenseClient.keys().create({
            description: "Search-only events key.",
            actions: ["documents:search"],
            collections: ["events"],
        });
        console.log("🚀 ~ result ~ result:", result);

        console.log(`✅ Search-only key created: ${result.id}`);

        return result.id;
    } catch (error) {
        console.error("❌ Error setting up search-only key:", error);
        throw error;
    }
}

// Run sync
syncTypesense();
