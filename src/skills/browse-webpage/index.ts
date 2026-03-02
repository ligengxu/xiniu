import { z } from "zod";
import * as cheerio from "cheerio";
import { renderPage } from "@/lib/puppeteer-render";
import type { SkillDefinition } from "../types";

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractContent(html: string): { title: string; body: string } {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, iframe, noscript, svg").remove();
  const title = $("title").text().trim();
  const body = $("article, main, [role='main'], .content, .post-content, .article-body, #content, body")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10000);
  return { title, body };
}

export const browseWebpageSkill: SkillDefinition = {
  name: "browse_webpage",
  displayName: "浏览网页",
  description:
    "抓取并提取网页的主要文本内容。支持静态和动态渲染的网页（SPA/CSR站点会自动启动浏览器渲染）。如果反爬严重无法解析会返回原始HTML源码供AI分析。",
  icon: "Globe",
  parameters: z.object({
    url: z.string().url().describe("要浏览的网页URL"),
  }),
  execute: async (params) => {
    const { url } = params as { url: string };
    let domain: string;
    try {
      domain = new URL(url).hostname.replace("www.", "");
    } catch {
      domain = url;
    }

    let rawHtml: string | null = null;

    // Layer 1: fast fetch
    const html = await fetchHtml(url);
    if (html) {
      rawHtml = html;
      const result = extractContent(html);
      if (result.body.length >= 100) {
        return {
          success: true,
          message: `[${domain}] 成功获取网页内容 (fetch): ${result.title}\n\n${result.body}`,
          data: { title: result.title, content: result.body, url, method: "fetch" },
        };
      }
    }

    // Layer 2: puppeteer
    const dynamicHtml = await renderPage(url);
    if (dynamicHtml) {
      rawHtml = dynamicHtml;
      const result = extractContent(dynamicHtml);
      if (result.body.length >= 50) {
        return {
          success: true,
          message: `[${domain}] 成功获取网页内容 (浏览器渲染): ${result.title}\n\n${result.body}`,
          data: { title: result.title, content: result.body, url, method: "puppeteer" },
        };
      }
    }

    // Layer 3: return raw HTML for AI analysis
    if (rawHtml && rawHtml.length > 200) {
      const snippet = rawHtml.substring(0, 5000);
      return {
        success: true,
        message: `[${domain}] 无法提取结构化正文（可能有反爬保护），返回原始HTML源码 (${rawHtml.length}字符) 供分析:\n\n\`\`\`html\n${snippet}\n\`\`\``,
        data: { title: "", content: snippet, url, method: "raw_html", rawLength: rawHtml.length },
      };
    }

    return {
      success: false,
      message: `[${domain}] 无法获取网页内容（fetch和浏览器渲染均失败）`,
    };
  },
};
