import type { APIRoute } from 'astro';
import { Client } from '@notionhq/client';
import { NOTION_API_KEY, NOTION_DATABASE_ID } from 'astro:env/server';

interface FeedbackPayload {
    message: string;
    email?: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
    const { env } = (locals as any).runtime;
    
    const notion = new Client({
        auth: NOTION_API_KEY || env.NOTION_API_KEY,
    });

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
