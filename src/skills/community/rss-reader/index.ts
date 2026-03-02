import { z } from "zod";
import type { SkillDefinition } from "../types";

interface FeedItem {
  title: string;
  link: string;
  date?: string;
  summary?: string;
}

function extractTag(xml: string, tag: string): string {
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i");
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim().replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*?${attr}=["']([^"']+)["']`, "i");
  const m = xml.match(re);
  return m ? m[1] : "";
}

async function parseFeed(url: string, limit: number): Promise<{ title: string; items: FeedItem[] }> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 XiniuAgent/1.0", Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

  const xml = await resp.text();
  const feedTitle = extractTag(xml, "title") || url;
  const items: FeedItem[] = [];

  const isAtom = xml.includes("<feed") && xml.includes("xmlns=\"http://www.w3.org/2005/Atom\"");

  if (isAtom) {
    const entries = xml.split(/<entry[\s>]/i).slice(1);
    for (const entry of entries.slice(0, limit)) {
      items.push({
        title: extractTag(entry, "title") || "(无标题)",
        link: extractAttr(entry, "link", "href") || extractTag(entry, "link"),
        date: extractTag(entry, "published") || extractTag(entry, "updated"),
        summary: extractTag(entry, "summary").slice(0, 200),
      });
    }
  } else {
    const rssItems = xml.split(/<item[\s>]/i).slice(1);
    for (const item of rssItems.slice(0, limit)) {
      items.push({
        title: extractTag(item, "title") || "(无标题)",
        link: extractTag(item, "link") || extractTag(item, "guid"),
        date: extractTag(item, "pubDate") || extractTag(item, "dc:date"),
        summary: extractTag(item, "description").slice(0, 200),
      });
    }
  }

  return { title: feedTitle, items };
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return dateStr; }
}

export const rssReaderSkill: SkillDefinition = {
  name: "rss_reader",
  displayName: "订阅源阅读",
  description:
    "读取RSS/Atom订阅源，获取最新文章列表。支持任意RSS链接。" +
    "用户说'RSS'、'订阅'、'feed'、'订阅源'、'资讯订阅'时使用。",
  icon: "Rss",
  category: "life",
  parameters: z.object({
    url: z.string().describe("RSS/Atom订阅源URL"),
    limit: z.number().optional().describe("获取条数，默认10，最大50"),
  }),
  execute: async (params) => {
    const { url, limit: rawLimit } = params as { url: string; limit?: number };

    if (!url?.trim()) return { success: false, message: "❌ 请提供RSS订阅源URL" };

    const limit = Math.min(Math.max(rawLimit || 10, 1), 50);

    try {
      const { title, items } = await parseFeed(url, limit);

      if (items.length === 0) {
        return { success: true, message: `📡 ${title}\n━━━━━━━━━━━━━━━━━━━━\n暂无文章` };
      }

      let msg = `📡 ${title} (${items.length}篇)\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const dateStr = item.date ? ` · ${formatDate(item.date)}` : "";
        msg += `${i + 1}. **${item.title}**${dateStr}\n`;
        if (item.link) msg += `   🔗 ${item.link}\n`;
        if (item.summary) msg += `   ${item.summary.slice(0, 100)}${item.summary.length > 100 ? "..." : ""}\n`;
        msg += `\n`;
      }

      return {
        success: true,
        message: msg,
        data: { feedTitle: title, count: items.length, items: items as unknown as Record<string, unknown>[] },
      };
    } catch (err) {
      return { success: false, message: `❌ 订阅源读取失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
