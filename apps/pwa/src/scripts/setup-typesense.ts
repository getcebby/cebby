import { eventsCollectionSchema, typesenseAdminClient } from '../lib/typesense-node';

import type { EventDocument } from '../lib/typesense-node';
import type { EventFromDB } from '../types/database';
import { supabase } from '../lib/supabase-node';

// Transform Supabase event to Typesense document
function transformEventForTypesense(event: any): EventDocument {
    return {
        id: String(event.id), // Ensure ID is always a string
        name: event.name || '',
        description: event.description || '',
        start_time: Math.floor(new Date(event.start_time).getTime() / 1000),
        end_time: event.end_time ? Math.floor(new Date(event.end_time).getTime() / 1000) : undefined,
        location: event.location || '',
        organization: event.accounts?.name || '',
        is_free: event.is_free || true,
        is_online: event.is_online || false,
        tags: event.tags?.map((t: any) => t.name) || [],
        slug: event.slug ? String(event.slug) : null,
        cover_photo: event.cover_photo,
    };
}

// Create the events collection
async function createEventsCollection() {
    try {
        console.log('Creating events collection...');
        await typesenseAdminClient.collections().create(eventsCollectionSchema as any);
        console.log('✅ Events collection created successfully');
    } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
            console.log('📝 Events collection already exists, skipping creation');
        } else {
            console.error('❌ Error creating collection:', error);
            throw error;
        }
    }
}

// Sync all events from Supabase to Typesense
async function syncEventsToTypesense() {
    try {
        console.log('Fetching events from Supabase...');

        const { data: events, error } = await supabase
            .from('events')
            .select(
                `
                    *,
                    accounts!left(*)
                `,
            )
            .filter('is_hidden', 'not.is', 'true')
            .order('start_time', { ascending: false });

        if (error) {
            throw new Error(`Supabase error: ${error.message}`);
        }

        if (!events || events.length === 0) {
            console.log('📝 No events found to sync');
            return;
        }

        console.log(`📊 Found ${events.length} events to sync`);

        // Transform events for Typesense
        const documents = events.map(transformEventForTypesense);

        // Import to Typesense in batches
        const batchSize = 100;
        let synced = 0;

        for (let i = 0; i < documents.length; i += batchSize) {
            const batch = documents.slice(i, i + batchSize);

            try {
                const result = await typesenseAdminClient
                    .collections('events')
                    .documents()
                    .import(batch, { action: 'upsert' });

                synced += batch.length;
                console.log(`📤 Synced ${synced}/${documents.length} events`);
            } catch (batchError: any) {
                console.error(`❌ Error syncing batch ${i}-${i + batch.length}:`);

                if (batchError.importResults) {
                    // Show detailed import errors
                    batchError.importResults.forEach((result: any, index: number) => {
                        if (!result.success) {
                            const doc = batch[index];
                            console.error(`  Document ${doc.id}: ${result.error}`);
                            console.error(`  Data:`, JSON.stringify(doc, null, 2));
                        }
                    });
                } else {
                    console.error(`  ${batchError.message || batchError}`);
                }

                // Continue with other batches instead of stopping
            }
        }

        console.log(`✅ Successfully synced ${synced} events to Typesense`);
    } catch (error) {
        console.error('❌ Error syncing events:', error);
        throw error;
    }
}

// Test search functionality
async function testSearch() {
    try {
        console.log('\n🔍 Testing search functionality...');

        const testResults = await typesenseAdminClient.collections('events').documents().search({
            q: 'python',
            query_by: 'name,description,organization',
            per_page: 3,
        });

        console.log(`✅ Search test successful! Found ${testResults.found} results`);

        if (testResults.hits && testResults.hits.length > 0) {
            console.log('📋 Sample results:');
            testResults.hits.forEach((hit, index) => {
                const doc = hit.document as EventDocument;
                console.log(`  ${index + 1}. "${doc.name}" by ${doc.organization}`);
            });
        }
    } catch (error) {
        console.error('❌ Search test failed:', error);
    }
}

// Setup search-only key
async function setupSearchOnlyKey() {
    try {
        console.log('\n🔍 Setting up search-only key...');

        const result = await typesenseAdminClient.keys().create({
            description: 'Search-only events key.',
            actions: ['documents:search'],
            collections: ['events'],
        });
        console.log('🚀 ~ result ~ result:', result);

        console.log(`✅ Search-only key created: ${result.id}`);

        return result.id;
    } catch (error) {
        console.error('❌ Error setting up search-only key:', error);
        throw error;
    }
}

// Main setup function
async function setupTypesense() {
    console.log('🚀 Setting up Typesense for Cebby...\n');

    try {
        await createEventsCollection();
        await syncEventsToTypesense();
        await testSearch();

        console.log('\n🎉 Typesense setup completed successfully!');
        console.log('🔗 You can now use the search functionality in your app');

        // const searchOnlyKey = await setupSearchOnlyKey();
        // console.log(`🔗 Search-only key created: ${searchOnlyKey}`);
    } catch (error) {
        console.error('\n💀 Setup failed:', error);
        process.exit(1);
    }
}

// Run setup if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    setupTypesense();
}

export { setupTypesense, createEventsCollection, syncEventsToTypesense };
