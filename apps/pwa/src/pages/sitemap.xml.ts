import { defaultSEO } from "../config/seo";

// Get all .astro files from the pages directory
const pages = Object.keys(import.meta.glob("./**/*.astro"))
  .map(
    (file) =>
      file
        .replace("./pages", "") // Remove pages directory prefix
        .replace(".astro", "") // Remove .astro extension
        .replace("/index", "/") // Convert /index to /
  )
  .filter(
    (page) =>
      !page.includes("[") && // Exclude dynamic routes
      !page.includes("404") // Exclude 404 page
  )
  .sort((a, b) => a.localeCompare(b)); // Sort alphabetically

function generateSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${pages
        .map((page) => {
          return `
            <url>
              <loc>${defaultSEO.siteUrl}${page}</loc>
              <changefreq>daily</changefreq>
              <priority>${page === "" ? "1.0" : "0.7"}</priority>
            </url>
          `;
        })
        .join("")}
    </urlset>`;
}

export async function get() {
  return {
    body: generateSitemap(),
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  };
}
