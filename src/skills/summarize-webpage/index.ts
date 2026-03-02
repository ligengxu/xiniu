import { z } from "zod";
import * as cheerio from "cheerio";
import type { SkillDefinition } from "../types";

export const summarizeWebpageSkill: SkillDefinition = {
  name: "summarize_webpage",
  displayName: "总结网页",
  description:
    "抓取网页内容并返回给AI进行摘要总结。用户可能会说'总结这个页面'、'帮我概括一下这个网址的内容'等。",
  icon: "BookOpen",
  parameters: z.object({
    url: z.string().url().describe("要总结的网页URL"),
  }),
  execute: async (params) => {
    const { url } = params as { url: string };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
      });
      const html = await res.text();
      const $ = cheerio.load(html);

      $("script, style, nav, footer, header, iframe, noscript").remove();

      const title = $("title").text().trim();
      const body = $("body")
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 6000);

      return {
        success: true,
        message: `已获取网页内容，请根据以下内容生成摘要:\n\n标题: ${title}\n\n${body}`,
        data: { title, content: body, url },
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};
