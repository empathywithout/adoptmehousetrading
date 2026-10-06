import { readFileSync, writeFileSync, readdirSync } from "fs";
import path from "path";

const SITE_URL = "https://adoptmehousetrading.com";
const houses = JSON.parse(readFileSync(path.join(process.cwd(), "data", "houses.json"), "utf-8"));

// Hand-maintained lists rot. This one listed comps.html (no such file; it
// 301s to recent-trades.html, and a sitemap should never advertise a
// redirect), listed profile.html (a signed-in dashboard, nothing for Google
// to index), and omitted recent-trades.html along with three of the five
// guides — including the verified-trades page, which is the most
// differentiated content on the site.
//
// Guides are now read off disk, so writing a new guide is enough to get it
// listed. Everything else is a short, deliberate list of real pages.
const GUIDE_EXCLUDE = new Set(["index.html", "entry.html", "submit.html"]);

const guideFiles = readdirSync(path.join(process.cwd(), "public", "guides"))
  .filter((f) => f.endsWith(".html") && !GUIDE_EXCLUDE.has(f))
  .sort();

const staticRoutes = [
  { path: "", priority: "1.0", changefreq: "daily" },
  { path: "listings/index.html", priority: "0.9", changefreq: "hourly" },
  { path: "houses/index.html", priority: "0.8", changefreq: "weekly" },
  // The site's own verified trade data — unique content, and it was missing.
  { path: "recent-trades.html", priority: "0.8", changefreq: "daily" },
  { path: "commissions/index.html", priority: "0.7", changefreq: "daily" },
  { path: "registry/index.html", priority: "0.6", changefreq: "daily" },
  { path: "guides/index.html", priority: "0.6", changefreq: "daily" },
  ...guideFiles.map((f) => ({ path: `guides/${f}`, priority: "0.7", changefreq: "monthly" })),
  { path: "list-a-house.html", priority: "0.5", changefreq: "monthly" },
  { path: "rules.html", priority: "0.3", changefreq: "monthly" },
  { path: "about.html", priority: "0.3", changefreq: "monthly" },
  { path: "contact.html", priority: "0.3", changefreq: "monthly" },
];

const houseRoutes = houses.map((h) => ({ path: `houses/${h.id}.html`, priority: "0.6", changefreq: "weekly" }));

const allRoutes = [...staticRoutes, ...houseRoutes];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allRoutes
  .map(
    (r) => `  <url>
    <loc>${SITE_URL}/${r.path}</loc>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;

writeFileSync(path.join(process.cwd(), "public", "sitemap.xml"), xml);
console.log(`Generated sitemap.xml with ${allRoutes.length} URLs.`);
