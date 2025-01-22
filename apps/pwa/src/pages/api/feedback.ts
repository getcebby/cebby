import type { APIRoute } from 'astro';
import { Client } from '@notionhq/client';

interface FeedbackPayload {
    message: string;
    email?: string;
}

export const POST: APIRoute = async ({ request }) => {
    const notion = new Client({
        auth: import.meta.env.NOTION_API_KEY || process.env.NOTION_API_KEY,
    });
    const NOTION_DATABASE_ID = import.meta.env.NOTION_DATABASE_ID || process.env.NOTION_DATABASE_ID;

    try {
        const payload = (await request.json()) as FeedbackPayload;

        if (!payload.message) {
            return new Response(JSON.stringify({ error: 'Message is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Create properties object with required fields
        const properties: any = {
            Message: {
                rich_text: [
                    {
                        text: {
                            content: payload.message,
                        },
                    },
                ],
            },
        };

        // Add email if provided
        if (payload.email) {
            properties.Email = {
                email: payload.email,
            };
        }

        // Create a page in the Notion database
        await notion.pages.create({
            parent: { database_id: NOTION_DATABASE_ID },
            properties,
        });

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error submitting feedback:', error);
        return new Response(JSON.stringify({ error: 'Failed to submit feedback' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
