import { z } from "zod";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

const FONT_PATHS = [
  "C:/Windows/Fonts/simhei.ttf",
  "C:/Windows/Fonts/msyh.ttc",
  "C:/Windows/Fonts/simsun.ttc",
];

function hasNonAscii(text: string): boolean {
  return /[^\x00-\x7F]/.test(text);
}

export const generatePdfSkill: SkillDefinition = {
  name: "generate_pdf",
  displayName: "生成排版文档",
  description:
    "根据文本内容生成专业PDF文档，支持中文、自动分页、标题分级、页码、作者信息。用户可能会说'导出PDF'、'生成PDF'、'保存为PDF'等。",
  icon: "FileText",
  category: "office",
  parameters: z.object({
    title: z.string().describe("PDF标题"),
    content: z.string().describe("PDF正文内容(Markdown格式)：# 一级标题, ## 二级标题, - 列表, > 引用, 普通段落"),
    author: z.string().optional().describe("作者名称，默认'犀牛 Agent'"),
    savePath: z.string().describe("保存路径（含文件名），例如 C:/Users/Administrator/Desktop/文档.pdf"),
  }),
  execute: async (params) => {
    try {
      const { title, content, savePath, author } = params as {
        title: string; content: string; savePath: string; author?: string;
      };

      const resolved = path.resolve(savePath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      const authorName = author || "犀牛 Agent";

      const pdfDoc = await PDFDocument.create();
      pdfDoc.setTitle(title);
      pdfDoc.setAuthor(authorName);
      pdfDoc.setCreationDate(new Date());

      const needsChinese = hasNonAscii(title) || hasNonAscii(content);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let font: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let boldFont: any;

      if (needsChinese) {
        pdfDoc.registerFontkit(fontkit);
        let loaded = false;
        for (const fp of FONT_PATHS) {
          try {
            const fontBytes = await fs.readFile(fp);
            font = await pdfDoc.embedFont(fontBytes);
            boldFont = font;
            loaded = true;
            break;
          } catch { /* try next */ }
        }
        if (!loaded) {
          font = await pdfDoc.embedFont(StandardFonts.Helvetica);
          boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        }
      } else {
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      }

      const W = 595;
      const H = 842;
      const M = 55;
      const maxW = W - M * 2;
      const accentColor = rgb(0.145, 0.388, 0.922);
      const textColor = rgb(0.13, 0.16, 0.21);
      const subColor = rgb(0.4, 0.4, 0.45);

      let page = pdfDoc.addPage([W, H]);
      let y = H - M;
      let pageNum = 1;

      function drawPageNumber() {
        const text = `${pageNum}`;
        const w = font.widthOfTextAtSize(text, 9);
        page.drawText(text, { x: (W - w) / 2, y: 25, size: 9, font, color: subColor });
      }

      function newPage() {
        drawPageNumber();
        pageNum++;
        page = pdfDoc.addPage([W, H]);
        y = H - M;
      }

      function ensureSpace(needed: number) {
        if (y < M + needed) newPage();
      }

      function drawWrapped(text: string, size: number, f: typeof font, color: typeof textColor, indent = 0, lineH = 18) {
        const chars = [...text];
        let line = "";
        const effectiveW = maxW - indent;
        for (const ch of chars) {
          const test = line + ch;
          if (f.widthOfTextAtSize(test, size) > effectiveW && line.length > 0) {
            ensureSpace(lineH);
            page.drawText(line, { x: M + indent, y, size, font: f, color });
            y -= lineH;
            line = ch;
          } else {
            line = test;
          }
        }
        if (line) {
          ensureSpace(lineH);
          page.drawText(line, { x: M + indent, y, size, font: f, color });
          y -= lineH;
        }
      }

      // ===== COVER =====
      y = H - 200;
      page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: accentColor });

      drawWrapped(title, 26, boldFont, rgb(0.08, 0.15, 0.37));
      y -= 15;
      page.drawLine({ start: { x: M, y }, end: { x: M + 120, y }, thickness: 3, color: accentColor });
      y -= 25;

      const dateStr = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
      drawWrapped(`${authorName}  ·  ${dateStr}`, 11, font, subColor);
      y -= 60;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
      y -= 30;

      // ===== CONTENT =====
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
          y -= 8;
          continue;
        }

        if (trimmed.startsWith("### ")) {
          ensureSpace(30);
          y -= 8;
          drawWrapped(trimmed.slice(4), 13, boldFont, rgb(0.2, 0.2, 0.3));
          y -= 4;
        } else if (trimmed.startsWith("## ")) {
          ensureSpace(35);
          y -= 12;
          drawWrapped(trimmed.slice(3), 15, boldFont, rgb(0.1, 0.2, 0.4));
          y -= 6;
        } else if (trimmed.startsWith("# ")) {
          ensureSpace(40);
          y -= 18;
          drawWrapped(trimmed.slice(2), 18, boldFont, accentColor);
          y -= 4;
          page.drawLine({ start: { x: M, y }, end: { x: M + 60, y }, thickness: 2, color: accentColor });
          y -= 10;
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
          const text = trimmed.replace(/^[-*•]\s*/, "");
          ensureSpace(18);
          page.drawCircle({ x: M + 6, y: y - 4, size: 2.5, color: accentColor });
          drawWrapped(text, 11, font, textColor, 18);
        } else if (/^\d+[.、)]\s/.test(trimmed)) {
          ensureSpace(18);
          drawWrapped(trimmed, 11, font, textColor, 18);
        } else if (trimmed.startsWith("> ")) {
          ensureSpace(22);
          page.drawRectangle({ x: M, y: y - 14, width: 3, height: 18, color: accentColor });
          drawWrapped(trimmed.slice(2), 10, font, subColor, 12);
          y -= 2;
        } else {
          ensureSpace(18);
          drawWrapped(trimmed, 11, font, textColor);
        }
      }

      drawPageNumber();

      const pdfBytes = await pdfDoc.save();
      await fs.writeFile(resolved, pdfBytes);

      const sizeKB = (pdfBytes.length / 1024).toFixed(1);
      return {
        success: true,
        message: `PDF 已生成: ${resolved}\n${pdfDoc.getPageCount()} 页 · ${sizeKB} KB\n特性: 封面标题 · 分级标题 · 列表引用 · 页码 · 中文支持`,
        data: { path: resolved, pages: pdfDoc.getPageCount() },
      };
    } catch (err) {
      return { success: false, message: `PDF 生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
