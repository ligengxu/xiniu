import { z } from "zod";
import type { SkillDefinition } from "../types";

const PRESETS: Record<string, string> = {
  allow_all: `User-agent: *\nAllow: /\n\nSitemap: {{sitemap}}`,
  block_all: `User-agent: *\nDisallow: /`,
  standard: `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /private/\nDisallow: /*.json$\nDisallow: /*.xml$\n\nUser-agent: Googlebot\nAllow: /\n\nUser-agent: Bingbot\nAllow: /\n\nSitemap: {{sitemap}}`,
  blog: `User-agent: *\nAllow: /\nDisallow: /wp-admin/\nDisallow: /wp-includes/\nDisallow: /wp-content/plugins/\nDisallow: /trackback/\nDisallow: /feed/\nDisallow: /?s=\nDisallow: /search/\n\nSitemap: {{sitemap}}`,
  ecommerce: `User-agent: *\nAllow: /\nDisallow: /cart/\nDisallow: /checkout/\nDisallow: /account/\nDisallow: /admin/\nDisallow: /api/\nDisallow: /*?sort=\nDisallow: /*?filter=\nDisallow: /*?page=\n\nSitemap: {{sitemap}}`,
};

export const robotsGenSkill: SkillDefinition = {
  name: "robots_gen",
  displayName: "爬虫协议生成",
  description:
    "生成网站的robots.txt爬虫协议文件，支持预设模板和自定义规则。" +
    "用户说'robots.txt'、'爬虫协议'、'robots'时使用。",
  icon: "Bot",
  category: "dev",
  parameters: z.object({
    preset: z.enum(["allow_all", "block_all", "standard", "blog", "ecommerce", "custom"]).optional()
      .describe("预设模板: allow_all/block_all/standard/blog/ecommerce/custom，默认standard"),
    sitemapUrl: z.string().optional().describe("Sitemap URL"),
    disallow: z.array(z.string()).optional().describe("custom时: 禁止爬取的路径列表"),
    allow: z.array(z.string()).optional().describe("custom时: 允许爬取的路径列表"),
    crawlDelay: z.number().optional().describe("爬取延迟(秒)"),
    savePath: z.string().optional().describe("保存路径"),
  }),
  execute: async (params) => {
    const { preset, sitemapUrl, disallow, allow, crawlDelay, savePath } = params as {
      preset?: string; sitemapUrl?: string; disallow?: string[]; allow?: string[];
      crawlDelay?: number; savePath?: string;
    };

    try {
      const fs = await import("fs");
      const path = await import("path");

      let content: string;
      const tmpl = preset || "standard";

      if (tmpl === "custom") {
        const lines = ["User-agent: *"];
        if (allow) for (const a of allow) lines.push(`Allow: ${a}`);
        if (disallow) for (const d of disallow) lines.push(`Disallow: ${d}`);
        if (crawlDelay) lines.push(`Crawl-delay: ${crawlDelay}`);
        if (sitemapUrl) lines.push("", `Sitemap: ${sitemapUrl}`);
        content = lines.join("\n");
      } else {
        content = PRESETS[tmpl] || PRESETS.standard;
        content = content.replace(/{{sitemap}}/g, sitemapUrl || "https://example.com/sitemap.xml");
        if (crawlDelay) content += `\nCrawl-delay: ${crawlDelay}`;
      }

      const outputPath = savePath || path.join("C:\\Users\\Administrator\\Desktop", "robots.txt");
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, content + "\n", "utf-8");

      let msg = `✅ robots.txt 已生成\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📋 模板: ${tmpl}\n📁 保存: ${outputPath}\n\n`;
      msg += `📄 内容预览:\n${content}`;

      return { success: true, message: msg, data: { path: outputPath } };
    } catch (err) {
      return { success: false, message: `❌ 生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
