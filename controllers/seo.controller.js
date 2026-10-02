import prisma from "../lib/prisma.js";
import { slugify } from "../utils/slug.js";

const SITE = () => (process.env.CLIENT_URL || "https://bedavadanbul.com").replace(/\/+$/, "");

const xmlEsc = (v) =>
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const urlTag = (loc, { lastmod, changefreq, priority } = {}) =>
  `<url><loc>${xmlEsc(loc)}</loc>${
    lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ""
  }${changefreq ? `<changefreq>${changefreq}</changefreq>` : ""}${
    priority ? `<priority>${priority}</priority>` : ""
  }</url>`;

let cache = { at: 0, xml: "" };

export const sitemap = async (req, res) => {
  try {
    if (cache.xml && Date.now() - cache.at < 60 * 60 * 1000) {
      res.set("Content-Type", "application/xml; charset=utf-8");
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(cache.xml);
    }

    const base = SITE();
    const [businesses, groups, posts] = await Promise.all([
      prisma.business.findMany({
        where: { isActive: true },
        select: { id: true, updatedAt: true },
        take: 20000,
      }),
      prisma.business.groupBy({
        by: ["city", "district"],
        where: { isActive: true },
        _count: { _all: true },
      }),
      prisma.post.findMany({
        where: {
          approved: true,
          OR: [{ expireDate: null }, { expireDate: { gt: new Date() } }],
        },
        select: { id: true, createdAt: true },
        take: 20000,
      }),
    ]);

    const urls = [
      urlTag(`${base}/`, { changefreq: "daily", priority: "1.0" }),
      urlTag(`${base}/isletmeler`, { changefreq: "daily", priority: "0.8" }),
    ];

    const cities = new Set();
    for (const g of groups) {
      const cs = slugify(g.city);
      const ds = slugify(g.district);
      if (!cs || !ds) continue;
      if (!cities.has(cs)) {
        cities.add(cs);
        urls.push(urlTag(`${base}/isletmeler/${cs}`, { changefreq: "daily", priority: "0.7" }));
      }
      urls.push(urlTag(`${base}/isletmeler/${cs}/${ds}`, { changefreq: "weekly", priority: "0.6" }));
    }
    for (const b of businesses) {
      urls.push(
        urlTag(`${base}/isletme/${b.id}`, {
          lastmod: b.updatedAt,
          changefreq: "weekly",
          priority: "0.7",
        }),
      );
    }
    for (const p of posts) {
      urls.push(
        urlTag(`${base}/${p.id}`, { lastmod: p.createdAt, changefreq: "weekly", priority: "0.6" }),
      );
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    cache = { at: Date.now(), xml };

    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(xml);
  } catch (err) {
    console.error("sitemap hatası:", err);
    res.status(500).send("Sitemap oluşturulamadı");
  }
};
