import { readFileSync, writeFileSync } from "fs";
import path from "path";

const SITE_URL = "https://adoptmehousetrading.com";
const houses = JSON.parse(readFileSync(path.join(process.cwd(), "data", "houses.json"), "utf-8"));

const staticRoutes = [
  { path: "", priority: "1.0", changefreq: "daily" },
  { path: "listings/index.html", priority: "0.9", changefreq: "hourly" },
  { path: "commissions/index.html", priority: "0.7", changefreq: "daily" },
  { path: "registry/index.html", priority: "0.6", changefreq: "daily" },
  { path: "comps.html", priority: "0.6", changefreq: "daily" },
  { path: "houses/index.html", priority: "0.8", changefreq: "weekly" },
  { path: "list-a-house.html", priority: "0.5", changefreq: "monthly" },
  { path: "profile.html", priority: "0.3", changefreq: "monthly" },
  { path: "rules.html", priority: "0.3", changefreq: "monthly" },
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
