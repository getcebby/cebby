import { defaultSEO } from "../config/seo";

const pages = [
  "",
  "/about",
  "/contact",
  "/partner",
  "/events",
  "/features/visibility",
  "/features/analytics",
  "/features/community-management",
  "/blog",
  "/support",
  "/privacy",
  "/terms",
];

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
