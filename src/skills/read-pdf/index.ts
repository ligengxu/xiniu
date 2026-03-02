import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

async function parsePdf(buffer: Buffer, options: Record<string, unknown> = {}) {
  // pdf-parse v1 在顶层 require 时会尝试读取测试文件
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse/lib/pdf-parse");
  return pdfParse(buffer, options);
}

export const readPdfSkill: SkillDefinition = {
  name: "read_pdf",
  displayName: "读取文档",
  description:
    "读取 PDF 文件内容并提取文字。支持本地文件路径和网络URL。用户可能会说'读取PDF'、'打开PDF'、'看看这个PDF'等。",
  icon: "FileDown",
  category: "office",
  parameters: z.object({
    source: z
      .string()
      .describe("PDF来源：本地文件路径（如 C:/Users/test/file.pdf）或网络URL（如 https://example.com/file.pdf）"),
    maxPages: z
      .number()
      .optional()
      .describe("最多读取的页数，默认全部。对超大PDF可限制"),
  }),
  execute: async (params) => {
    const { source, maxPages } = params as {
      source: string;
      maxPages?: number;
    };

    try {
      let buffer: Buffer;

      if (source.startsWith("http://") || source.startsWith("https://")) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          const res = await fetch(source, {
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });
          if (!res.ok) {
            return {
              success: false,
              message: `下载PDF失败: HTTP ${res.status} ${res.statusText}`,
            };
          }
          const arrayBuf = await res.arrayBuffer();
          buffer = Buffer.from(arrayBuf);
        } finally {
          clearTimeout(timeout);
        }
      } else {
        const resolved = path.resolve(source);
        const ext = path.extname(resolved).toLowerCase();
        if (ext !== ".pdf") {
          return { success: false, message: `不是PDF文件: ${ext}` };
        }
        buffer = await fs.readFile(resolved);
      }

      if (buffer.length > 50 * 1024 * 1024) {
        return {
          success: false,
          message: `PDF文件过大 (${(buffer.length / 1024 / 1024).toFixed(1)} MB)，最大支持50MB`,
        };
      }

      const options: Record<string, unknown> = {};
      if (maxPages && maxPages > 0) {
        options.max = maxPages;
      }

      const data = await parsePdf(buffer, options);

      const text: string = data.text || "";
      const totalPages: number = data.numpages || 0;
      const info = data.info || {};

      const truncated = text.length > 15000;
      const content = truncated ? text.slice(0, 15000) : text;

      const metadata: Record<string, unknown> = {
        totalPages,
        textLength: text.length,
        truncated,
        title: info.Title || null,
        author: info.Author || null,
        subject: info.Subject || null,
        creator: info.Creator || null,
        producer: info.Producer || null,
      };

      const sizeStr =
        buffer.length > 1024 * 1024
          ? `${(buffer.length / 1024 / 1024).toFixed(1)} MB`
          : `${(buffer.length / 1024).toFixed(1)} KB`;

      const pagesInfo = maxPages
        ? `(读取前 ${Math.min(maxPages, totalPages)} / ${totalPages} 页)`
        : `(共 ${totalPages} 页)`;

      return {
        success: true,
        message: `PDF读取成功 ${pagesInfo}，${sizeStr}，提取了 ${text.length} 个字符${truncated ? "（内容过长已截断至15000字）" : ""}:\n\n${content}`,
        data: { ...metadata, fileSize: sizeStr, source, content },
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("password") || errMsg.includes("encrypted")) {
        return {
          success: false,
          message: "PDF文件已加密，无法读取。请提供未加密的PDF文件。",
        };
      }
      return { success: false, message: `PDF解析失败: ${errMsg}` };
    }
  },
};
