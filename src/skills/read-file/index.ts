import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

export const readFileSkill: SkillDefinition = {
  name: "read_file",
  displayName: "读取文件内容",
  description:
    "读取文本文件的完整内容并返回。支持代码文件(.js/.ts/.html/.css/.py/.json等)和文本文件。用于查看代码、分析BUG、了解文件结构。可指定行号范围只读取部分内容。",
  icon: "FileText",
  category: "dev",
  parameters: z.object({
    filePath: z.string().describe("文件完整路径，如 C:/Users/Administrator/Desktop/snake-game.html"),
    startLine: z.number().optional().describe("起始行号（从1开始），不填则从头读取"),
    endLine: z.number().optional().describe("结束行号，不填则读到末尾"),
  }),
  execute: async (params) => {
    const { filePath, startLine, endLine } = params as {
      filePath: string;
      startLine?: number;
      endLine?: number;
    };
    if (!filePath || String(filePath).trim() === "") {
      return { success: false, message: "filePath 不能为空" };
    }
    const resolved = path.resolve(filePath);

    try {
      await fs.access(resolved);
    } catch {
      return { success: false, message: `文件不存在: ${resolved}` };
    }

    try {
      const stats = await fs.stat(resolved);
      if (stats.isDirectory()) {
        return { success: false, message: `目标是目录不是文件: ${resolved}` };
      }

      if (stats.size > 10 * 1024 * 1024) {
        return {
          success: false,
          message: `文件过大 (${(stats.size / 1024 / 1024).toFixed(1)}MB > 10MB)，请使用 startLine/endLine 参数分段读取`,
        };
      }

      const content = await fs.readFile(resolved, "utf-8");
      const allLines = content.split("\n");
      const totalLines = allLines.length;
      const ext = path.extname(resolved).toLowerCase();

      let resultLines = allLines;
      let rangeDesc = `全部 ${totalLines} 行`;
      let requestedRange = false;

      if (startLine || endLine) {
        requestedRange = true;
        const s = Math.max(1, startLine || 1);
        const e = Math.min(totalLines, endLine || totalLines);
        resultLines = allLines.slice(s - 1, e);
        rangeDesc = `第 ${s}-${e} 行（共 ${totalLines} 行）`;
      }

      const numberedContent = resultLines
        .map((line, i) => {
          const lineNum = (startLine || 1) + i;
          return `${String(lineNum).padStart(6, " ")} | ${line}`;
        })
        .join("\n");

      const maxOutput = 120000;
      const truncated = numberedContent.length > maxOutput;
      let output = truncated
        ? numberedContent.slice(0, maxOutput)
        : numberedContent;

      if (truncated) {
        const shownLines = output.split("\n").length;
        const lastLineMatch = output.match(/^\s*(\d+)\s*\|/m);
        const approxEndLine = lastLineMatch ? parseInt(lastLineMatch[1]) + shownLines : shownLines;
        output += `\n\n━━ 已截断 (显示约${shownLines}行/${totalLines}行) ━━`;
        output += `\n继续读取: startLine=${approxEndLine + 1}`;
        output += `\n全文正则搜索: 用 regex_tester + filePath 参数`;
      }

      return {
        success: true,
        message: `文件: ${path.basename(resolved)} (${rangeDesc})\n类型: ${ext}\n大小: ${(stats.size / 1024).toFixed(1)}KB\n\n${output}`,
        data: {
          path: resolved,
          totalLines,
          readLines: resultLines.length,
          extension: ext,
          size: stats.size,
          truncated,
          ...(truncated && !requestedRange ? { hint: "文件较大已截断，用 startLine/endLine 分段读取，或用 regex_tester + filePath 全文搜索" } : {}),
        },
      };
    } catch (err) {
      return {
        success: false,
        message: `读取文件失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
