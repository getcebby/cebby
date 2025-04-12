import type { APIRoute } from 'astro';
import { supabase } from '../lib/supabase';

// Custom type for the subset of event fields we need
interface SitemapEventData {
    id: string | number;
    slug: string | null;
    name: string | null;
    start_time: string | null;
    created_at: string;
}

// Generate the sitemap XML content
const generateSitemapXml = (events: SitemapEventData[], baseUrl: string) => {
    // Start with XML declaration and urlset opening tag
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Static pages -->
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/events</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${baseUrl}/calendar</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;

    // Add each event URL
    events.forEach((event) => {
        // Use slug if available, otherwise use ID
        const eventPath = event.slug ? event.slug : `event--${event.id}`;
        const eventUrl = `${baseUrl}/events/${eventPath}`;
        const lastmod = new Date(event.created_at).toISOString();

        xml += `
  <url>
    <loc>${eventUrl}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
    });

    // Close the urlset tag
    xml += `
</urlset>`;

    return xml;
};

export const GET: APIRoute = async () => {
    const baseUrl = 'https://www.getcebby.com';

    try {
        // Fetch all events including past and future
        const { data, error } = await supabase
            .from('events')
            .select('id, slug, name, start_time, created_at')
            .filter('is_hidden', 'not.is', 'true')
            .order('start_time', { ascending: false });

        if (error) {
            console.error('Error fetching events for sitemap:', error);
            return new Response('Error generating sitemap', { status: 500 });
        }

        // Use our custom type for the events data
        const events = data as SitemapEventData[];

        // Generate the sitemap XML content
        const xml = generateSitemapXml(events || [], baseUrl);

        // Return the XML with proper content type
        return new Response(xml, {
            status: 200,
            headers: {
                'Content-Type': 'application/xml',
                'Cache-Control': 'public, max-age=3600',
            },
        });
    } catch (error) {
        console.error('Sitemap generation error:', error);
        return new Response('Error generating sitemap', { status: 500 });
    }
};
