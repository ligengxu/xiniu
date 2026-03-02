import { z } from "zod";
import type { SkillDefinition } from "../types";

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

function buildSitemapXml(urls: SitemapUrl[]): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  for (const url of urls) {
    xml += `  <url>\n    <loc>${escapeXml(url.loc)}</loc>\n`;
    if (url.lastmod) xml += `    <lastmod>${url.lastmod}</lastmod>\n`;
    if (url.changefreq) xml += `    <changefreq>${url.changefreq}</changefreq>\n`;
    if (url.priority != null) xml += `    <priority>${url.priority.toFixed(1)}</priority>\n`;
    xml += `  </url>\n`;
  }

  xml += `</urlset>`;
  return xml;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function crawlSitemap(baseUrl: string, maxPages: number): Promise<SitemapUrl[]> {
  const visited = new Set<string>();
  const urls: SitemapUrl[] = [];
  const queue = [baseUrl];

  const normalizeUrl = (href: string, base: string): string | null => {
    try {
      const u = new URL(href, base);
      if (u.origin !== new URL(base).origin) return null;
      u.hash = "";
      u.search = "";
      return u.href;
    } catch { return null; }
  };

  while (queue.length > 0 && urls.length < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "XiniuSitemapBot/1.0" },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      if (!resp.ok) continue;

      const ct = resp.headers.get("content-type") || "";
      if (!ct.includes("html")) continue;

      const html = await resp.text();
      const today = new Date().toISOString().slice(0, 10);

      const depth = new URL(url).pathname.split("/").filter(Boolean).length;
      const priority = Math.max(0.1, 1.0 - depth * 0.2);

      urls.push({ loc: url, lastmod: today, changefreq: depth === 0 ? "daily" : "weekly", priority });

      const linkRe = /href=["']([^"'#]+)["']/gi;
      let match;
      while ((match = linkRe.exec(html)) !== null) {
        const normalized = normalizeUrl(match[1], url);
        if (normalized && !visited.has(normalized) && !queue.includes(normalized)) {
          const ext = normalized.split(".").pop()?.toLowerCase();
          if (!["jpg", "png", "gif", "css", "js", "pdf", "zip", "mp4", "mp3", "svg", "woff", "woff2", "ttf"].includes(ext || "")) {
            queue.push(normalized);
          }
        }
      }
    } catch { continue; }
  }

  return urls;
}

export const sitemapGenSkill: SkillDefinition = {
  name: "sitemap_gen",
  displayName: "站点地图生成",
  description:
    "生成网站的sitemap.xml站点地图，支持手动输入URL列表或自动爬取网站页面。" +
    "用户说'sitemap'、'站点地图'、'网站地图'、'SEO'时使用。",
  icon: "Map",
  category: "dev",
  parameters: z.object({
    action: z.enum(["manual", "crawl"]).describe("操作: manual=手动输入URL列表, crawl=自动爬取网站"),
    baseUrl: z.string().optional().describe("crawl时的起始URL"),
    urls: z.array(z.object({
      loc: z.string().describe("页面URL"),
      changefreq: z.string().optional().describe("更新频率: always/hourly/daily/weekly/monthly/yearly/never"),
      priority: z.number().optional().describe("优先级 0.0-1.0"),
    })).optional().describe("manual时的URL列表"),
    maxPages: z.number().optional().describe("crawl时最大爬取页数，默认50"),
    savePath: z.string().optional().describe("保存路径"),
  }),
  execute: async (params) => {
    const { action, baseUrl, urls: inputUrls, maxPages, savePath } = params as {
      action: string; baseUrl?: string;
      urls?: Array<{ loc: string; changefreq?: string; priority?: number }>;
      maxPages?: number; savePath?: string;
    };

    try {
      const fs = await import("fs");
      const path = await import("path");

      let sitemapUrls: SitemapUrl[] = [];

      if (action === "crawl") {
        if (!baseUrl) return { success: false, message: "❌ 请提供起始URL (baseUrl 参数)" };
        const limit = Math.min(maxPages || 50, 200);
        sitemapUrls = await crawlSitemap(baseUrl, limit);

        if (sitemapUrls.length === 0) {
          return { success: false, message: `❌ 未能从 ${baseUrl} 爬取到任何页面` };
        }
      } else if (action === "manual") {
        if (!inputUrls || inputUrls.length === 0) return { success: false, message: "❌ 请提供 urls 列表" };
        const today = new Date().toISOString().slice(0, 10);
        sitemapUrls = inputUrls.map((u) => ({
          loc: u.loc,
          lastmod: today,
          changefreq: u.changefreq || "weekly",
          priority: u.priority ?? 0.8,
        }));
      } else {
        return { success: false, message: `❌ 未知操作: ${action}` };
      }

      const xml = buildSitemapXml(sitemapUrls);
      const outputPath = savePath || path.join("C:\\Users\\Administrator\\Desktop", "sitemap.xml");
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, xml, "utf-8");

      const sizeKB = (Buffer.byteLength(xml) / 1024).toFixed(1);

      let msg = `✅ 站点地图已生成\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📊 URL数量: ${sitemapUrls.length}\n`;
      msg += `📁 保存: ${outputPath} (${sizeKB}KB)\n`;
      if (action === "crawl") msg += `🕷️ 模式: 自动爬取 (起始: ${baseUrl})\n`;
      msg += `\n📋 前5条URL:\n`;
      for (const u of sitemapUrls.slice(0, 5)) {
        msg += `  ${u.loc} [${u.changefreq || "-"}, ${u.priority?.toFixed(1) || "-"}]\n`;
      }
      if (sitemapUrls.length > 5) msg += `  ... 共 ${sitemapUrls.length} 条`;

      return { success: true, message: msg, data: { path: outputPath, count: sitemapUrls.length } };
    } catch (err) {
      return { success: false, message: `❌ 站点地图生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
