import { z } from "zod";
import type { SkillDefinition } from "../types";

export const pdfMergeSkill: SkillDefinition = {
  name: "pdf_merge",
  displayName: "文档合并拆分",
  description:
    "PDF文件合并与拆分：将多个PDF合并为一个，或将一个PDF按页码拆分。" +
    "用户说'合并PDF'、'拆分PDF'、'PDF合并'、'PDF拆分'时使用。",
  icon: "FileStack",
  category: "office",
  parameters: z.object({
    action: z.enum(["merge", "split"]).describe("操作: merge=合并多个PDF, split=拆分PDF"),
    files: z.array(z.string()).optional().describe("merge时: 要合并的PDF文件路径列表（按顺序）"),
    inputFile: z.string().optional().describe("split时: 要拆分的PDF文件路径"),
    pages: z.string().optional().describe("split时: 页码范围，如'1-3,5,8-10'，不填则每页拆一个文件"),
    outputPath: z.string().optional().describe("输出文件路径（merge时为输出文件名，split时为输出目录）"),
  }),
  execute: async (params) => {
    const { action, files, inputFile, pages, outputPath } = params as {
      action: string; files?: string[]; inputFile?: string; pages?: string; outputPath?: string;
    };

    try {
      const { PDFDocument } = await import("pdf-lib").catch(() => {
        throw new Error("请先安装 pdf-lib: npm install pdf-lib");
      });
      const fs = await import("fs");
      const path = await import("path");

      if (action === "merge") {
        if (!files || files.length < 2) return { success: false, message: "❌ 合并至少需要2个PDF文件 (files 参数)" };

        for (const f of files) {
          if (!fs.existsSync(f)) return { success: false, message: `❌ 文件不存在: ${f}` };
        }

        const merged = await PDFDocument.create();
        let totalPages = 0;

        for (const f of files) {
          const bytes = fs.readFileSync(f);
          const doc = await PDFDocument.load(bytes);
          const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
          for (const page of copiedPages) merged.addPage(page);
          totalPages += doc.getPageCount();
        }

        const outPath = outputPath || path.join("C:\\Users\\Administrator\\Desktop", `merged_${Date.now()}.pdf`);
        const outDir = path.dirname(outPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        const pdfBytes = await merged.save();
        fs.writeFileSync(outPath, pdfBytes);

        const sizeKB = (pdfBytes.length / 1024).toFixed(1);
        let msg = `✅ PDF合并完成\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📄 输入: ${files.length}个文件\n`;
        msg += `📊 总页数: ${totalPages}页\n`;
        msg += `📁 输出: ${outPath} (${sizeKB}KB)`;

        return { success: true, message: msg, data: { path: outPath, pages: totalPages, size: pdfBytes.length } };
      }

      if (action === "split") {
        if (!inputFile) return { success: false, message: "❌ 请提供要拆分的PDF文件 (inputFile 参数)" };
        if (!fs.existsSync(inputFile)) return { success: false, message: `❌ 文件不存在: ${inputFile}` };

        const bytes = fs.readFileSync(inputFile);
        const srcDoc = await PDFDocument.load(bytes);
        const totalPages = srcDoc.getPageCount();

        const outDir = outputPath || path.join("C:\\Users\\Administrator\\Desktop", `split_${Date.now()}`);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        const pageGroups: number[][] = [];

        if (pages) {
          for (const part of pages.split(",")) {
            const range = part.trim().match(/^(\d+)(?:-(\d+))?$/);
            if (!range) continue;
            const start = parseInt(range[1]) - 1;
            const end = range[2] ? parseInt(range[2]) - 1 : start;
            const group: number[] = [];
            for (let i = Math.max(0, start); i <= Math.min(end, totalPages - 1); i++) group.push(i);
            if (group.length > 0) pageGroups.push(group);
          }
        } else {
          for (let i = 0; i < totalPages; i++) pageGroups.push([i]);
        }

        if (pageGroups.length === 0) return { success: false, message: "❌ 无有效页码" };

        const outputFiles: string[] = [];
        for (let i = 0; i < pageGroups.length; i++) {
          const doc = await PDFDocument.create();
          const copied = await doc.copyPages(srcDoc, pageGroups[i]);
          for (const page of copied) doc.addPage(page);

          const fileName = `page_${pageGroups[i].map((p) => p + 1).join("-")}.pdf`;
          const filePath = path.join(outDir, fileName);
          fs.writeFileSync(filePath, await doc.save());
          outputFiles.push(fileName);
        }

        let msg = `✅ PDF拆分完成\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📄 源文件: ${totalPages}页\n`;
        msg += `📊 拆分为: ${outputFiles.length}个文件\n`;
        msg += `📁 输出目录: ${outDir}\n`;
        msg += `📋 文件列表:\n${outputFiles.map((f) => `  • ${f}`).join("\n")}`;

        return { success: true, message: msg, data: { dir: outDir, count: outputFiles.length } };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ PDF操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
