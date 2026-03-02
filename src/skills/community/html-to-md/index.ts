import { z } from "zod";
import type { SkillDefinition } from "../types";
import * as fs from "fs";

function htmlToMarkdown(html: string): string {
  let md = html;

  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<!--[\s\S]*?-->/g, "");

  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  md = md.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~");
  md = md.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, "~~$1~~");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  md = md.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, "==$1==");

  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  md = md.replace(/<pre[^>]*><code[^>]*(?:class="[^"]*language-(\w+)")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, lang, code) => `\n\`\`\`${lang || ""}\n${decodeHtmlEntities(code).trim()}\n\`\`\`\n`);
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => `\n\`\`\`\n${decodeHtmlEntities(code).trim()}\n\`\`\`\n`);

  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    return content.trim().split("\n").map((l: string) => `> ${l.trim()}`).join("\n") + "\n";
  });

  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n").trim() + "\n";
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    let idx = 0;
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => {
      idx++;
      const match = content.match(/<li[^>]*>([\s\S]*?)<\/li>/gi);
      const text = match ? match[idx - 1]?.replace(/<\/?li[^>]*>/gi, "") || "" : "";
      return `${idx}. ${text.trim()}\n`;
    }).trim() + "\n";
  });

  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows: string[][] = [];
    const trMatches = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (const tr of trMatches) {
      const cells: string[] = [];
      const cellMatches = tr.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) || [];
      for (const cell of cellMatches) {
        const text = cell.replace(/<\/?(?:td|th)[^>]*>/gi, "").trim();
        cells.push(text);
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length === 0) return "";
    const header = rows[0];
    const sep = header.map(() => "---");
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${sep.join(" | ")} |`,
      ...rows.slice(1).map(r => `| ${r.join(" | ")} |`),
    ];
    return "\n" + lines.join("\n") + "\n";
  });

  md = md.replace(/<hr[^>]*\/?>/gi, "\n---\n");
  md = md.replace(/<br[^>]*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, "\n$1\n");

  md = md.replace(/<[^>]+>/g, "");
  md = decodeHtmlEntities(md);

  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.trim();

  return md;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export const htmlToMdSkill: SkillDefinition = {
  name: "html_to_md",
  displayName: "网页转文档",
  description: "将 HTML 内容转换为 Markdown 格式。支持标题、列表、表格、链接、图片、代码块、引用等元素。用户说'HTML转Markdown'、'html转md'、'html to markdown'、'网页转markdown'时使用。",
  icon: "FileType",
  category: "dev",
  parameters: z.object({
    input: z.string().optional().describe("HTML 文本内容"),
    filePath: z.string().optional().describe("HTML 文件路径（优先于 input）"),
    url: z.string().optional().describe("网页 URL（从网页抓取 HTML 后转换）"),
    output: z.string().optional().describe("输出 Markdown 文件路径（可选）"),
  }),
  execute: async (params) => {
    const { input, filePath, url, output } = params as {
      input?: string; filePath?: string; url?: string; output?: string;
    };

    try {
      let html = input || "";

      if (filePath) {
        if (!fs.existsSync(filePath)) return { success: false, message: `❌ 文件不存在: ${filePath}` };
        html = fs.readFileSync(filePath, "utf-8");
      } else if (url) {
        try {
          const resp = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            signal: AbortSignal.timeout(15000),
          });
          if (!resp.ok) return { success: false, message: `❌ 获取网页失败: HTTP ${resp.status}` };
          html = await resp.text();
        } catch (err) {
          return { success: false, message: `❌ 获取网页异常: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      if (!html.trim()) return { success: false, message: "❌ 请提供 HTML 内容（input/filePath/url 三选一）" };

      const markdown = htmlToMarkdown(html);

      if (output) {
        const dir = require("path").dirname(output);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(output, markdown, "utf-8");
        return {
          success: true,
          message: `📝 HTML → Markdown 转换完成\n━━━━━━━━━━━━━━━━━━━━\n📥 来源: ${url || filePath || "文本输入"}\n📤 输出: ${output}\n📊 字符数: ${markdown.length}`,
        };
      }

      const preview = markdown.length > 3000 ? markdown.slice(0, 3000) + "\n\n... (截断，共 " + markdown.length + " 字符)" : markdown;
      return {
        success: true,
        message: `📝 HTML → Markdown 转换完成\n━━━━━━━━━━━━━━━━━━━━\n📊 字符数: ${markdown.length}\n\n${preview}`,
        data: { markdown, length: markdown.length },
      };
    } catch (err) {
      return { success: false, message: `❌ 转换异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
