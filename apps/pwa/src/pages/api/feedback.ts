import type { APIRoute } from 'astro';
import { Client } from '@notionhq/client';
import { NOTION_API_KEY, NOTION_DATABASE_ID } from 'astro:env/server';

interface FeedbackContext {
    pageUrl?: string;
    pagePath?: string;
    pageTitle?: string;
    eventSlug?: string;
    eventTitle?: string;
    feedbackCategory?: string;
    triggerLabel?: string;
    referrer?: string;
    viewport?: string;
    devicePixelRatio?: number;
    language?: string;
    timezone?: string;
    userAgent?: string;
}

interface FeedbackPayload {
    message?: string;
    email?: string;
    category?: string;
    context?: FeedbackContext;
}

const RICH_TEXT_CHUNK_LENGTH = 1800;

function sanitizeText(value: unknown, maxLength = 500): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;

    const text = String(value).replace(/\s+/g, ' ').trim();
    if (!text) return undefined;

    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function toNotionRichText(content: string) {
    const chunks = content.match(new RegExp(`[\\s\\S]{1,${RICH_TEXT_CHUNK_LENGTH}}`, 'g')) ?? [''];

    return chunks.map((chunk) => ({
        text: {
            content: chunk,
        },
    }));
}

function buildFeedbackMessage(
    message: string,
    context: FeedbackContext | undefined,
    request: Request,
    category?: string,
) {
    const requestReferer = sanitizeText(request.headers.get('referer'), 1000);
    const requestUserAgent = sanitizeText(request.headers.get('user-agent'), 1000);
    const pageUrl = sanitizeText(context?.pageUrl, 1000) || requestReferer;
    const lines: string[] = [];

    const addLine = (label: string, value: unknown, maxLength?: number) => {
        const text = sanitizeText(value, maxLength);
        if (text) lines.push(`${label}: ${text}`);
    };

    addLine('Page', context?.pageTitle);
    addLine('URL', pageUrl, 1000);
    addLine('Path', context?.pagePath, 1000);
    addLine('Event', context?.eventTitle);
    addLine('Event slug', context?.eventSlug);
    addLine('Category', category || context?.feedbackCategory);
    addLine('Opened from', context?.triggerLabel);

    const referrer = sanitizeText(context?.referrer, 1000) || requestReferer;
    if (referrer && referrer !== pageUrl) addLine('Referrer', referrer, 1000);

    addLine('Viewport', context?.viewport);
    addLine('Device pixel ratio', context?.devicePixelRatio);
    addLine('Language', context?.language);
    addLine('Timezone', context?.timezone);
    addLine('User agent', context?.userAgent || requestUserAgent, 1000);
    addLine('Submitted at', new Date().toISOString());

    if (lines.length === 0) return message;

    return `${message}\n\n---\nContext\n${lines.join('\n')}`;
}

export const POST: APIRoute = async ({ request, locals }) => {
    const { env } = (locals as any).runtime;

    const notion = new Client({
        auth: NOTION_API_KEY || env.NOTION_API_KEY,
    });

    try {
        const payload = (await request.json()) as FeedbackPayload;
        const message = sanitizeText(payload.message, 4000);
        const email = sanitizeText(payload.email, 254);

        if (!message) {
            return new Response(JSON.stringify({ error: 'Message is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const category = sanitizeText(payload.category || payload.context?.feedbackCategory, 120);
        const notionMessage = buildFeedbackMessage(message, payload.context, request, category);

        // Create properties object with required fields
        const properties: any = {
            Message: {
                rich_text: toNotionRichText(notionMessage),
            },
        };

        // Add email if provided
        if (email) {
            properties.Email = {
                email,
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
