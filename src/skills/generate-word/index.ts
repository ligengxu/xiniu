import { z } from "zod";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Header, Footer, PageNumber, NumberFormat,
  Tab, TabStopType, TabStopPosition, BorderStyle,
} from "docx";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

export const generateWordSkill: SkillDefinition = {
  name: "generate_word",
  displayName: "生成文字文档",
  description:
    "根据内容生成专业级 Word (.docx) 文档，自动生成目录、页眉页脚、页码、格式化标题/列表/引用/表格/粗体/斜体。用户可能会说'帮我写一份报告'、'生成文档'、'创建Word'等。",
  icon: "FileText",
  category: "office",
  parameters: z.object({
    title: z.string().describe("文档标题"),
    content: z
      .string()
      .describe("文档内容(Markdown格式)：# 一级标题, ## 二级标题, ### 三级标题, - 列表, > 引用, **粗体**, *斜体*, 普通段落用空行分隔"),
    author: z.string().optional().describe("作者名称，默认'犀牛 Agent'"),
    addToc: z.boolean().optional().describe("是否生成目录页，默认内容超过5个标题时自动添加"),
    savePath: z.string().describe("保存路径（含文件名），例如 C:/Users/Administrator/Desktop/报告.docx"),
  }),
  execute: async (params) => {
    try {
      const { title, content, savePath, author, addToc } = params as {
        title: string; content: string; savePath: string; author?: string; addToc?: boolean;
      };

      const resolved = path.resolve(savePath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      const authorName = author || "犀牛 Agent";

      const paragraphs: Paragraph[] = [];

      // cover title
      paragraphs.push(new Paragraph({ spacing: { before: 2400 } }));
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: title, size: 56, bold: true, color: "1E3A5F" })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }),
      );

      // subtitle line
      const dateStr = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `${authorName}  ·  ${dateStr}`, size: 22, color: "666666", italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
      );

      // separator
      paragraphs.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1E3A5F" } },
          spacing: { after: 600 },
        }),
      );

      // count headings for TOC decision
      const lines = content.split("\n");
      const headingCount = lines.filter(l => /^#{1,3}\s/.test(l.trim())).length;
      const shouldAddToc = addToc ?? headingCount >= 5;

      if (shouldAddToc) {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: "目  录", size: 32, bold: true, color: "1E3A5F" })],
            spacing: { before: 400, after: 200 },
          }),
        );
        const headingLines = lines.filter(l => /^#{1,3}\s/.test(l.trim()));
        headingLines.forEach((hl, idx) => {
          const trimmed = hl.trim();
          const level = (trimmed.match(/^#+/) || [""])[0].length;
          const text = trimmed.replace(/^#+\s*/, "");
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${idx + 1}. ${text}`, size: 22, color: "333333" }),
              ],
              spacing: { before: 60, after: 60 },
              indent: { left: (level - 1) * 480 },
            }),
          );
        });
        paragraphs.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" } },
            spacing: { after: 400 },
          }),
        );
        paragraphs.push(new Paragraph({ pageBreakBefore: true }));
      }

      // parse content
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          paragraphs.push(new Paragraph({ spacing: { before: 80 } }));
          continue;
        }

        if (trimmed.startsWith("### ")) {
          paragraphs.push(
            new Paragraph({
              text: trimmed.slice(4),
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 200, after: 100 },
            }),
          );
        } else if (trimmed.startsWith("## ")) {
          paragraphs.push(
            new Paragraph({
              text: trimmed.slice(3),
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 300, after: 150 },
            }),
          );
        } else if (trimmed.startsWith("# ")) {
          paragraphs.push(
            new Paragraph({
              text: trimmed.slice(2),
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 400, after: 200 },
            }),
          );
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
          const text = trimmed.replace(/^[-*•]\s*/, "");
          paragraphs.push(
            new Paragraph({
              children: parseInlineStyles(text, 22),
              spacing: { before: 60, after: 60 },
              indent: { left: 720 },
              bullet: { level: 0 },
            }),
          );
        } else if (/^\d+[.、)]\s/.test(trimmed)) {
          const text = trimmed.replace(/^\d+[.、)]\s*/, "");
          paragraphs.push(
            new Paragraph({
              children: parseInlineStyles(text, 22),
              spacing: { before: 60, after: 60 },
              indent: { left: 720 },
            }),
          );
        } else if (trimmed.startsWith("> ")) {
          const text = trimmed.slice(2);
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text, size: 22, italics: true, color: "555555" })],
              spacing: { before: 100, after: 100 },
              indent: { left: 720 },
              border: { left: { style: BorderStyle.SINGLE, size: 12, color: "1E3A5F", space: 8 } },
            }),
          );
        } else {
          paragraphs.push(
            new Paragraph({
              children: parseInlineStyles(trimmed, 22),
              spacing: { before: 80, after: 80 },
              indent: { firstLine: 480 },
            }),
          );
        }
      }

      const doc = new Document({
        sections: [{
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: title, size: 16, color: "999999" }),
                    new TextRun({ children: [new Tab()], size: 16 }),
                    new TextRun({ text: authorName, size: 16, color: "999999" }),
                  ],
                  tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
                  border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" } },
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "999999" }),
                    new TextRun({ text: " / ", size: 18, color: "999999" }),
                    new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "999999" }),
                  ],
                  alignment: AlignmentType.CENTER,
                }),
              ],
            }),
          },
          properties: {
            page: { pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
          },
          children: paragraphs,
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      await fs.writeFile(resolved, buffer);

      const sizeKB = (buffer.length / 1024).toFixed(1);
      return {
        success: true,
        message: `Word 文档已生成: ${resolved}\n大小: ${sizeKB} KB\n特性: 封面标题 · ${shouldAddToc ? "自动目录 · " : ""}页眉页脚 · 页码 · Markdown格式化`,
        data: { path: resolved, size: buffer.length },
      };
    } catch (err) {
      return { success: false, message: `Word 生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

function parseInlineStyles(text: string, size: number): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+))/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], size, bold: true }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], size, italics: true }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], size: size - 2, font: "Consolas", color: "C7254E", shading: { fill: "F9F2F4" } }));
    } else if (match[5]) {
      runs.push(new TextRun({ text: match[5], size }));
    }
  }
  if (runs.length === 0) runs.push(new TextRun({ text, size }));
  return runs;
}
