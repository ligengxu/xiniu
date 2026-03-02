import { z } from "zod";
import { generateText } from "ai";
import * as cheerio from "cheerio";
import { getModel } from "@/lib/models";
import { renderPage } from "@/lib/puppeteer-render";
import type { SkillDefinition } from "../types";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface FetchResult {
  html: string | null;
  status: number;
  error?: string;
}

async function fetchPage(url: string, timeoutMs = 15000): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) return { html: null, status: res.status };
    return { html: await res.text(), status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) return { html: null, status: 0, error: "timeout" };
    return { html: null, status: 0, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function extractLinks(html: string, baseUrl: string, maxItems: number): SearchResult[] {
  const $ = cheerio.load(html);
  $("script, style, iframe, noscript, svg").remove();

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  if (bodyText.length < 50) return [];

  const scored: { title: string; url: string; snippet: string; score: number }[] = [];
  const seenKeys = new Set<string>();

  $("a[href]").each((_, el) => {
    if (scored.length >= maxItems * 3) return;
    const $el = $(el);
    const title = $el.text().trim().replace(/\s+/g, " ");
    const href = $el.attr("href") || "";

    if (!title || title.length < 8 || title.length > 200) return;
    if (href === "#" || href === "" || href.startsWith("javascript:")) return;

    let fullUrl = href;
    if (!href.startsWith("http")) {
      try { fullUrl = new URL(href, baseUrl).toString(); } catch { return; }
    }

    const titleKey = title.substring(0, 25);
    if (seenKeys.has(titleKey)) return;
    seenKeys.add(titleKey);

    let score = 0;
    const parentTag = $el.parent()?.[0]?.tagName?.toLowerCase() || "";
    const grandParentTag = $el.parent()?.parent()?.[0]?.tagName?.toLowerCase() || "";

    if (["h1", "h2", "h3", "h4"].includes(parentTag)) score += 10;
    if (["h1", "h2", "h3", "h4"].includes(grandParentTag)) score += 8;
    if ($el.closest("article, main, [role='main']").length > 0) score += 5;
    if ($el.closest("nav, footer, aside, header").length > 0) score -= 8;
    if (title.length >= 15) score += 3;
    if (/\d{4}[-/]\d{2}/.test(fullUrl)) score += 4;

    const snippet = $el.parent().find("p, span, .desc, .summary").first()
      .text().trim().replace(/\s+/g, " ").substring(0, 150) || "";

    scored.push({ title, url: fullUrl, snippet, score });
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxItems).map(({ title, url, snippet }) => ({ title, url, snippet }));
}

function extractPageText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, iframe, noscript, svg").remove();
  return $("article, main, [role='main'], .content, body")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

// ═══════════════════════════════════════════════════════════
// Skill 1: search_plan — AI 分析搜索意图，生成目标网站列表
// ═══════════════════════════════════════════════════════════

export const searchPlanSkill: SkillDefinition = {
  name: "search_plan",
  displayName: "搜索规划",
  description:
    "分析搜索意图，通过AI智能推荐最相关的目标网站URL列表。这是搜索流程的第一步。用户说'搜索'时应先调用此工具获取目标网站，然后逐个调用 scrape_site 抓取。",
  icon: "Search",
  category: "life",
  parameters: z.object({
    query: z.string().describe("用户的搜索意图描述"),
  }),
  execute: async (params) => {
    const { query } = params as { query: string };

    try {
      const searchProviderId = process.env.SEARCH_PROVIDER_ID || "qwen";
      const searchModelId = process.env.SEARCH_MODEL_ID || "qwen-turbo";
      const model = getModel(searchProviderId, searchModelId);
      const { text } = await generateText({
        model,
        prompt: `你是搜索规划助手。用户想搜索: "${query}"

请推荐6个最可能找到相关内容的网页URL，用JSON数组输出。
要求: 真实可访问的完整URL，优先垂直媒体，最后加百度和Bing搜索页URL。
每项包含url和reason字段。

直接输出一个完整JSON数组，开头是[，结尾是]，不要多余文字:
[{"url":"https://example.com","reason":"原因"},{"url":"https://www.baidu.com/s?wd=${encodeURIComponent(query)}","reason":"百度搜索"}]`,
        maxOutputTokens: 800,
      });

      let sites: { url: string; reason: string }[] = [];

      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          sites = JSON.parse(arrayMatch[0]);
        } catch { /* fallback below */ }
      }

      if (sites.length === 0) {
        const objectMatches = [...text.matchAll(/\{[^{}]*"url"\s*:\s*"([^"]+)"[^{}]*"reason"\s*:\s*"([^"]+)"[^{}]*\}/g)];
        if (objectMatches.length > 0) {
          sites = objectMatches.map((m) => ({ url: m[1], reason: m[2] }));
        }
      }

      if (sites.length === 0) {
        const urlMatches = [...text.matchAll(/https?:\/\/[^\s"',\]]+/g)];
        if (urlMatches.length > 0) {
          sites = urlMatches.map((m) => ({ url: m[0], reason: "AI推荐" }));
        }
      }

      sites = sites
        .filter((s) => s.url && s.url.startsWith("http"))
        .slice(0, 8);

      if (sites.length === 0) {
        return {
          success: false,
          message: "未生成有效的搜索目标",
        };
      }

      const formatted = sites
        .map((s, i) => `${i + 1}. ${new URL(s.url).hostname} — ${s.reason}\n   ${s.url}`)
        .join("\n");

      return {
        success: true,
        message: `根据搜索意图「${query}」，AI 推荐了 ${sites.length} 个目标网站:\n\n${formatted}`,
        data: {
          query,
          sites: sites.map((s) => ({ url: s.url, reason: s.reason, domain: new URL(s.url).hostname })),
          count: sites.length,
        },
      };
    } catch (err) {
      return {
        success: false,
        message: `搜索规划失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

// ═══════════════════════════════════════════════════════════
// Skill 2: scrape_site — 抓取单个网站内容
// ═══════════════════════════════════════════════════════════

export const scrapeSiteSkill: SkillDefinition = {
  name: "scrape_site",
  displayName: "抓取网站",
  description:
    "抓取单个网站并提取内容。先用快速HTTP请求，如果遇到反爬/CSR空页面会自动启动本地浏览器渲染。如果是搜索引擎结果页会提取搜索结果列表；如果是普通网站会提取文章链接列表或正文内容。",
  icon: "Globe",
  category: "life",
  parameters: z.object({
    url: z.string().describe("要抓取的网页URL"),
    mode: z.enum(["links", "content"]).optional()
      .describe("抓取模式: links=提取文章链接列表(默认), content=提取页面正文"),
  }),
  execute: async (params) => {
    const { url, mode = "links" } = params as { url: string; mode?: "links" | "content" };

    let domain: string;
    try {
      domain = new URL(url).hostname.replace("www.", "");
    } catch {
      return { success: false, message: `无效的URL: ${url}` };
    }

    // Step 1: try fast fetch
    const fetchResult = await fetchPage(url);
    let html = fetchResult.html;
    let method = "fetch";
    let isAntiCrawl = false;
    const httpStatus = fetchResult.status;

    if (httpStatus === 404 || httpStatus === 410) {
      return {
        success: false,
        message: `[${domain}] 页面不存在 (HTTP ${httpStatus})。建议：尝试该网站首页或修改URL路径后重试。`,
        data: { url, domain, method: "failed", failReason: "not_found", httpStatus, suggestion: "simplify_url" },
      };
    }

    if (httpStatus === 403) {
      return {
        success: false,
        message: `[${domain}] 访问被拒绝 (HTTP 403)。建议：使用 browse_webpage 工具通过浏览器访问。`,
        data: { url, domain, method: "failed", failReason: "forbidden", httpStatus, suggestion: "use_browse_webpage" },
      };
    }

    if (fetchResult.error === "timeout") {
      isAntiCrawl = true;
    } else if (html) {
      const $ = cheerio.load(html);
      $("script, style").remove();
      const bodyText = $("body").text().replace(/\s+/g, " ").trim();

      if (bodyText.length < 80) {
        isAntiCrawl = true;
      }
    } else {
      isAntiCrawl = true;
    }

    // Step 2: puppeteer fallback for anti-crawl / CSR
    if (isAntiCrawl) {
      method = "puppeteer";
      const dynamicHtml = await renderPage(url);
      if (dynamicHtml) {
        html = dynamicHtml;
      } else if (html) {
        method = "raw_html";
      } else {
        return {
          success: false,
          message: `[${domain}] 抓取失败：HTTP请求和浏览器渲染均无法获取内容。建议：使用 browse_webpage 工具直接浏览此URL，或尝试该网站的首页。`,
          data: { url, domain, method: "failed", failReason: "anti_crawl", suggestion: "use_browse_webpage" },
        };
      }
    }

    if (!html) {
      return {
        success: false,
        message: `[${domain}] 无法获取任何内容。建议：使用 browse_webpage 工具重试。`,
        data: { url, domain, failReason: "empty", suggestion: "use_browse_webpage" },
      };
    }

    // Detect search engine result pages
    const isSearchEngine = /baidu\.com\/s|bing\.com\/search|google\.com\/search|sogou\.com\/web/.test(url);

    if (isSearchEngine) {
      const $ = cheerio.load(html);
      const results: SearchResult[] = [];

      if (url.includes("baidu.com")) {
        $(".result, .c-container").each((_, el) => {
          if (results.length >= 10) return;
          const title = $(el).find("h3 a").text().trim();
          const href = $(el).find("h3 a").attr("href") || "";
          const snippet = $(el).find(".c-abstract, .content-right_8Zs40").text().trim();
          if (title && title.length >= 4 && href) {
            results.push({ title, url: href, snippet });
          }
        });
      } else if (url.includes("bing.com")) {
        $(".b_algo").each((_, el) => {
          if (results.length >= 10) return;
          const title = $(el).find("h2 a").text().trim();
          const href = $(el).find("h2 a").attr("href") || "";
          const snippet = $(el).find(".b_caption p, .b_lineclamp2").text().trim();
          if (title && href) {
            results.push({ title, url: href, snippet });
          }
        });
      }

      if (results.length > 0) {
        const formatted = results
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`)
          .join("\n\n");

        return {
          success: true,
          message: `[${domain}] 搜索引擎返回 ${results.length} 条结果 (${method}):\n\n${formatted}`,
          data: { url, domain, method, resultType: "search", results, count: results.length },
        };
      }

      return {
        success: false,
        message: `[${domain}] 搜索引擎页面已获取但无法解析出搜索结果（可能被反爬）。建议：使用 browse_webpage 浏览此URL，或换一个搜索关键词重试。`,
        data: { url, domain, method, failReason: "parse_failed", suggestion: "use_browse_webpage" },
      };
    }

    // Normal site: extract links or content
    if (mode === "content") {
      const text = extractPageText(html);
      if (text.length < 20) {
        if (method === "raw_html") {
          const rawSnippet = html.substring(0, 3000);
          return {
            success: true,
            message: `[${domain}] 疑似反爬网站，返回原始HTML片段供分析 (${rawSnippet.length}字符):\n\n\`\`\`html\n${rawSnippet}\n\`\`\``,
            data: { url, domain, method: "raw_html", resultType: "raw", rawLength: html.length },
          };
        }
        return {
          success: false,
          message: `[${domain}] 页面内容为空或无法解析。建议：使用 browse_webpage 工具重试，或尝试该网站的其他页面。`,
          data: { url, domain, method, failReason: "empty", suggestion: "use_browse_webpage" },
        };
      }

      const $ = cheerio.load(html);
      const title = $("title").text().trim();

      return {
        success: true,
        message: `[${domain}] 成功提取页面正文 (${method}, ${text.length}字符): ${title}\n\n${text.substring(0, 2000)}`,
        data: { url, domain, method, resultType: "content", title, content: text, contentLength: text.length },
      };
    }

    // mode === "links"
    const links = extractLinks(html, url, 10);

    if (links.length === 0) {
      const text = extractPageText(html);
      if (text.length >= 100) {
        const $ = cheerio.load(html);
        const title = $("title").text().trim();
        return {
          success: true,
          message: `[${domain}] 未找到文章链接，但提取到页面正文 (${method}, ${text.length}字符): ${title}\n\n${text.substring(0, 1500)}`,
          data: { url, domain, method, resultType: "content", title, content: text },
        };
      }

      if (method === "raw_html" || (html && html.length > 500)) {
        const rawSnippet = html.substring(0, 3000);
        return {
          success: true,
          message: `[${domain}] 无法提取结构化内容（可能是反爬/JS渲染），返回原始HTML片段 (${html.length}字符):\n\n\`\`\`html\n${rawSnippet}\n\`\`\``,
          data: { url, domain, method: "raw_html", resultType: "raw", rawLength: html.length },
        };
      }

      return {
        success: false,
        message: `[${domain}] 未能提取到任何有用内容。建议：使用 browse_webpage 工具直接浏览此URL，或改为抓取该网站首页。`,
        data: { url, domain, method, failReason: "empty", suggestion: "use_browse_webpage" },
      };
    }

    const formatted = links
      .map((r, i) => `${i + 1}. **${r.title}**${r.snippet ? `\n   ${r.snippet}` : ""}\n   ${r.url}`)
      .join("\n\n");

    return {
      success: true,
      message: `[${domain}] 提取到 ${links.length} 条内容 (${method}):\n\n${formatted}`,
      data: { url, domain, method, resultType: "links", results: links, count: links.length },
    };
  },
};

// ═══════════════════════════════════════════════════════════
// Skill 3: web_search — 保留为快速搜索引擎一键查询
// ═══════════════════════════════════════════════════════════

export const webSearchSkill: SkillDefinition = {
  name: "web_search",
  displayName: "搜索引擎",
  description:
    "同时查询百度和Bing搜索引擎，快速获取搜索结果列表。适合简单搜索。如果需要深度搜索，应先用 search_plan 规划目标网站，再用 scrape_site 逐站抓取。",
  icon: "Search",
  category: "life",
  parameters: z.object({
    query: z.string().describe("搜索关键词"),
  }),
  execute: async (params) => {
    const { query } = params as { query: string };

    const [baiduItems, bingItems] = await Promise.all([
      (async (): Promise<SearchResult[]> => {
        const { html } = await fetchPage(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=8`);
        if (!html) return [];
        const $ = cheerio.load(html);
        const r: SearchResult[] = [];
        $(".result, .c-container").each((_, el) => {
          if (r.length >= 8) return;
          const title = $(el).find("h3 a").text().trim();
          const href = $(el).find("h3 a").attr("href") || "";
          const snippet = $(el).find(".c-abstract, .content-right_8Zs40").text().trim();
          if (title && title.length >= 4 && href) r.push({ title, url: href, snippet });
        });
        return r;
      })().catch(() => []),
      (async (): Promise<SearchResult[]> => {
        const { html } = await fetchPage(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=8`);
        if (!html) return [];
        const $ = cheerio.load(html);
        const r: SearchResult[] = [];
        $(".b_algo").each((_, el) => {
          if (r.length >= 8) return;
          const title = $(el).find("h2 a").text().trim();
          const href = $(el).find("h2 a").attr("href") || "";
          const snippet = $(el).find(".b_caption p, .b_lineclamp2").text().trim();
          if (title && href) r.push({ title, url: href, snippet });
        });
        return r;
      })().catch(() => []),
    ]);

    let msg = "";

    if (baiduItems.length > 0) {
      msg += `**百度搜索** (${baiduItems.length}条):\n\n`;
      msg += baiduItems.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`).join("\n\n");
      msg += "\n\n";
    } else {
      msg += "**百度搜索**: 未获取到结果\n\n";
    }

    if (bingItems.length > 0) {
      msg += `**Bing搜索** (${bingItems.length}条):\n\n`;
      msg += bingItems.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`).join("\n\n");
    } else {
      msg += "**Bing搜索**: 未获取到结果";
    }

    const total = baiduItems.length + bingItems.length;

    return {
      success: total > 0,
      message: total > 0
        ? `搜索「${query}」共获得 ${total} 条结果:\n\n${msg}`
        : `搜索「${query}」未获得有效结果`,
      data: {
        query,
        baidu: { count: baiduItems.length, results: baiduItems },
        bing: { count: bingItems.length, results: bingItems },
        total,
      },
    };
  },
};
