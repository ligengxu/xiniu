import { z } from "zod";
import type { SkillDefinition } from "../types";

interface ScrapeResult {
  url: string;
  status: number;
  title: string;
  content: string;
  links: string[];
  images: string[];
  meta: Record<string, string>;
}

interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const re = /href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], baseUrl);
      links.add(u.href);
    } catch {}
  }
  return Array.from(links);
}

function extractImages(html: string, baseUrl: string): string[] {
  const imgs = new Set<string>();
  const re = /src=["']([^"']+\.(?:jpg|jpeg|png|gif|webp|svg|avif)[^"']*)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], baseUrl);
      imgs.add(u.href);
    } catch {}
  }
  return Array.from(imgs);
}

function extractMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) meta.title = titleMatch[1].trim();

  const metaRe = /<meta[^>]+(?:name|property)=["']([^"']+)["'][^>]+content=["']([^"']+)["']/gi;
  let m;
  while ((m = metaRe.exec(html)) !== null) meta[m[1]] = m[2];

  const metaRe2 = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']([^"']+)["']/gi;
  while ((m = metaRe2.exec(html)) !== null) meta[m[2]] = m[1];

  return meta;
}

function extractBySelector(html: string, selector: string): string[] {
  const results: string[] = [];
  const tagMatch = selector.match(/^(\w+)$/);
  const classMatch = selector.match(/^\.(\S+)$/);
  const idMatch = selector.match(/^#(\S+)$/);
  const attrMatch = selector.match(/^\[([^\]]+)\]$/);

  let re: RegExp;
  if (tagMatch) {
    re = new RegExp(`<${tagMatch[1]}[^>]*>([\\s\\S]*?)</${tagMatch[1]}>`, "gi");
  } else if (classMatch) {
    re = new RegExp(`<\\w+[^>]*class="[^"]*\\b${classMatch[1]}\\b[^"]*"[^>]*>([\\s\\S]*?)</\\w+>`, "gi");
  } else if (idMatch) {
    re = new RegExp(`<\\w+[^>]*id="${idMatch[1]}"[^>]*>([\\s\\S]*?)</\\w+>`, "gi");
  } else if (attrMatch) {
    re = new RegExp(`<\\w+[^>]*${attrMatch[1]}[^>]*>([\\s\\S]*?)</\\w+>`, "gi");
  } else {
    re = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)</${selector}>`, "gi");
  }

  let match;
  while ((match = re.exec(html)) !== null) {
    results.push(extractText(match[0]));
  }
  return results;
}

async function fetchWithRetry(
  url: string, retries: number, delay: number, headers: Record<string, string>,
  proxy?: ProxyConfig,
): Promise<{ ok: boolean; status: number; html: string; error?: string }> {
  for (let i = 0; i <= retries; i++) {
    try {
      const fetchHeaders: Record<string, string> = {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Cache-Control": "no-cache",
        ...headers,
      };

      let fetchUrl = url;
      if (proxy) {
        const proxyUrl = proxy.username
          ? `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
          : `http://${proxy.host}:${proxy.port}`;
        fetchHeaders["X-Proxy"] = proxyUrl;
      }

      const resp = await fetch(fetchUrl, {
        headers: fetchHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });

      if (!resp.ok && resp.status !== 301 && resp.status !== 302) {
        if (i < retries) {
          await new Promise((r) => setTimeout(r, delay * (i + 1)));
          continue;
        }
        return { ok: false, status: resp.status, html: "", error: `HTTP ${resp.status}` };
      }

      const html = await resp.text();
      return { ok: true, status: resp.status, html };
    } catch (err) {
      if (i < retries) {
        await new Promise((r) => setTimeout(r, delay * (i + 1)));
        continue;
      }
      return { ok: false, status: 0, html: "", error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, status: 0, html: "", error: "重试耗尽" };
}

async function scrapePage(
  url: string, selector?: string, retries = 2, headers: Record<string, string> = {},
  proxy?: ProxyConfig,
): Promise<ScrapeResult & { ok: boolean; error?: string }> {
  const result = await fetchWithRetry(url, retries, 2000, headers, proxy);
  if (!result.ok) {
    return { ok: false, url, status: result.status, title: "", content: "", links: [], images: [], meta: {}, error: result.error };
  }

  const html = result.html;
  const meta = extractMeta(html);
  const title = meta.title || "";
  const links = extractLinks(html, url);
  const images = extractImages(html, url);

  let content: string;
  if (selector) {
    const selected = extractBySelector(html, selector);
    content = selected.join("\n\n");
  } else {
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
      || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
      || html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    content = extractText(articleMatch ? articleMatch[0] : html);
  }

  if (content.length > 50000) content = content.slice(0, 50000) + "...(截断)";

  return { ok: true, url, status: result.status, title, content, links, images, meta };
}

async function batchScrape(
  urls: string[], selector?: string, concurrency = 3, retries = 2,
  headers: Record<string, string> = {}, proxy?: ProxyConfig,
  progressCallback?: (done: number, total: number) => void,
): Promise<Array<ScrapeResult & { ok: boolean; error?: string }>> {
  const results: Array<ScrapeResult & { ok: boolean; error?: string }> = [];
  const queue = [...urls];
  let done = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const url = queue.shift()!;
      const result = await scrapePage(url, selector, retries, headers, proxy);
      results.push(result);
      done++;
      progressCallback?.(done, urls.length);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

async function incrementalScrape(
  startUrl: string, maxPages: number, selector?: string,
  followPattern?: string, headers: Record<string, string> = {},
): Promise<Array<ScrapeResult & { ok: boolean; error?: string }>> {
  const visited = new Set<string>();
  const queue = [startUrl];
  const results: Array<ScrapeResult & { ok: boolean; error?: string }> = [];
  const baseOrigin = new URL(startUrl).origin;

  while (queue.length > 0 && results.length < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const result = await scrapePage(url, selector, 1, headers);
    results.push(result);

    if (result.ok && result.links) {
      for (const link of result.links) {
        if (visited.has(link) || queue.includes(link)) continue;
        try {
          const u = new URL(link);
          if (u.origin !== baseOrigin) continue;
          if (followPattern && !new RegExp(followPattern).test(link)) continue;
          queue.push(link);
        } catch {}
      }
    }

    if (results.length < maxPages) {
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
    }
  }

  return results;
}

export const webScraperProSkill: SkillDefinition = {
  name: "web_scraper_pro",
  displayName: "高级网页采集",
  description:
    "高级网页数据采集：反爬绕过（随机UA/代理池/重试）、CSS选择器提取、批量并发采集、增量爬取、数据导出。" +
    "用户说'爬虫'、'采集数据'、'批量抓取'、'爬取网页'、'数据采集'、'抓取列表'时使用。",
  icon: "Bug",
  category: "dev",
  parameters: z.object({
    action: z.enum(["single", "batch", "crawl", "extract"]).describe(
      "操作: single=单页采集, batch=批量采集(多URL), crawl=增量爬取(自动发现链接), extract=CSS选择器提取"
    ),
    url: z.string().optional().describe("single/crawl/extract时的目标URL"),
    urls: z.array(z.string()).optional().describe("batch时的URL列表"),
    selector: z.string().optional().describe("CSS选择器（如.article、#content、h2）用于精确提取"),
    maxPages: z.number().optional().describe("crawl时最大爬取页数，默认20"),
    followPattern: z.string().optional().describe("crawl时链接过滤正则（如'/article/'只跟踪文章链接）"),
    concurrency: z.number().optional().describe("batch时并发数，默认3"),
    retries: z.number().optional().describe("失败重试次数，默认2"),
    headers: z.record(z.string()).optional().describe("自定义请求头"),
    proxy: z.object({
      host: z.string(),
      port: z.number(),
      username: z.string().optional(),
      password: z.string().optional(),
    }).optional().describe("代理配置"),
    savePath: z.string().optional().describe("结果保存路径(JSON)"),
    saveContent: z.boolean().optional().describe("是否保存完整页面内容，默认true"),
  }),
  execute: async (params) => {
    const p = params as {
      action: string; url?: string; urls?: string[]; selector?: string;
      maxPages?: number; followPattern?: string; concurrency?: number; retries?: number;
      headers?: Record<string, string>; proxy?: ProxyConfig;
      savePath?: string; saveContent?: boolean;
    };

    try {
      const fs = await import("fs");
      const path = await import("path");

      switch (p.action) {
        case "single": {
          if (!p.url) return { success: false, message: "❌ 请提供 url" };
          const result = await scrapePage(p.url, p.selector, p.retries, p.headers || {}, p.proxy);
          if (!result.ok) return { success: false, message: `❌ 采集失败: ${result.error}` };

          let msg = `✅ 单页采集完成\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `🌐 URL: ${result.url}\n`;
          msg += `📝 标题: ${result.title}\n`;
          msg += `📊 内容: ${result.content.length}字 | 链接: ${result.links.length}个 | 图片: ${result.images.length}个\n`;
          msg += `\n📄 内容预览:\n${result.content.slice(0, 500)}${result.content.length > 500 ? "..." : ""}`;

          if (p.savePath) {
            const dir = path.dirname(p.savePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(p.savePath, JSON.stringify(result, null, 2), "utf-8");
            msg += `\n\n📁 已保存: ${p.savePath}`;
          }

          return { success: true, message: msg, data: { title: result.title, contentLength: result.content.length, links: result.links.length, images: result.images.length } };
        }

        case "batch": {
          if (!p.urls || p.urls.length === 0) return { success: false, message: "❌ 请提供 urls 列表" };
          const results = await batchScrape(
            p.urls, p.selector, p.concurrency || 3, p.retries || 2,
            p.headers || {}, p.proxy,
          );

          const ok = results.filter((r) => r.ok);
          const fail = results.filter((r) => !r.ok);

          let msg = `✅ 批量采集完成\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `📊 成功: ${ok.length} | 失败: ${fail.length} | 总计: ${results.length}\n\n`;

          for (const r of ok.slice(0, 10)) {
            msg += `✅ ${r.title || r.url} (${r.content.length}字)\n`;
          }
          for (const r of fail) {
            msg += `❌ ${r.url}: ${r.error}\n`;
          }

          const saveTo = p.savePath || path.join("C:\\Users\\Administrator\\Desktop", `scrape_batch_${Date.now()}.json`);
          const dir = path.dirname(saveTo);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          const saveData = results.map((r) => ({
            url: r.url, ok: r.ok, status: r.status, title: r.title,
            content: p.saveContent !== false ? r.content : r.content.slice(0, 200),
            links: r.links.length, images: r.images.length, error: r.error,
          }));
          fs.writeFileSync(saveTo, JSON.stringify(saveData, null, 2), "utf-8");
          msg += `\n📁 已保存: ${saveTo}`;

          return { success: true, message: msg, data: { total: results.length, success: ok.length, failed: fail.length, path: saveTo } };
        }

        case "crawl": {
          if (!p.url) return { success: false, message: "❌ 请提供起始 url" };
          const maxPages = Math.min(p.maxPages || 20, 100);
          const results = await incrementalScrape(p.url, maxPages, p.selector, p.followPattern, p.headers || {});

          const ok = results.filter((r) => r.ok);
          let msg = `✅ 增量爬取完成\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `🕷️ 起始: ${p.url}\n`;
          msg += `📊 爬取: ${results.length}页 | 成功: ${ok.length}\n`;
          if (p.followPattern) msg += `🔍 链接过滤: ${p.followPattern}\n`;
          msg += `\n📋 页面列表:\n`;
          for (const r of ok.slice(0, 15)) {
            msg += `  • ${r.title || r.url.slice(0, 60)} (${r.content.length}字)\n`;
          }

          const saveTo = p.savePath || path.join("C:\\Users\\Administrator\\Desktop", `scrape_crawl_${Date.now()}.json`);
          const dir = path.dirname(saveTo);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          const saveData = results.map((r) => ({
            url: r.url, ok: r.ok, title: r.title,
            content: p.saveContent !== false ? r.content : r.content.slice(0, 200),
            links: r.links.length, images: r.images.length,
          }));
          fs.writeFileSync(saveTo, JSON.stringify(saveData, null, 2), "utf-8");
          msg += `\n📁 已保存: ${saveTo}`;

          return { success: true, message: msg, data: { pages: results.length, success: ok.length, path: saveTo } };
        }

        case "extract": {
          if (!p.url) return { success: false, message: "❌ 请提供 url" };
          if (!p.selector) return { success: false, message: "❌ 请提供 selector (CSS选择器)" };

          const result = await fetchWithRetry(p.url, p.retries || 2, 2000, { ...(p.headers || {}) }, p.proxy);
          if (!result.ok) return { success: false, message: `❌ 页面获取失败: ${result.error}` };

          const extracted = extractBySelector(result.html, p.selector);
          if (extracted.length === 0) return { success: true, message: `⚠️ 选择器 "${p.selector}" 未匹配到任何内容` };

          let msg = `✅ 选择器提取完成\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `🌐 URL: ${p.url}\n`;
          msg += `🔍 选择器: ${p.selector}\n`;
          msg += `📊 匹配: ${extracted.length}项\n\n`;
          for (let i = 0; i < Math.min(extracted.length, 20); i++) {
            msg += `${i + 1}. ${extracted[i].slice(0, 200)}${extracted[i].length > 200 ? "..." : ""}\n`;
          }

          if (p.savePath) {
            const dir = path.dirname(p.savePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(p.savePath, JSON.stringify(extracted, null, 2), "utf-8");
            msg += `\n📁 已保存: ${p.savePath}`;
          }

          return { success: true, message: msg, data: { count: extracted.length, items: extracted.slice(0, 50) as unknown as Record<string, unknown>[] } };
        }

        default:
          return { success: false, message: `❌ 未知操作: ${p.action}` };
      }
    } catch (err) {
      return { success: false, message: `❌ 采集异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
