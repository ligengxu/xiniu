import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

export const mergeFilesSkill: SkillDefinition = {
  name: "merge_files",
  displayName: "合并文件",
  description:
    "将多个文件或文本片段按顺序合并为一个完整文件。用于并行生成代码模块后的组合拼接。支持两种模式：1)指定多个文件路径拼接 2)直接传入多个代码片段拼接。",
  icon: "Merge",
  category: "dev",
  parameters: z.object({
    outputPath: z.string().describe("输出文件的完整路径"),
    parts: z.array(
      z.object({
        type: z.enum(["file", "text"]).describe("片段类型：file=从文件读取, text=直接文本"),
        content: z.string().describe("文件路径（type=file时）或代码文本（type=text时）"),
        deleteAfterMerge: z.boolean().optional().describe("合并后是否删除源文件（仅file类型），默认true"),
      })
    ).describe("要合并的片段列表，按顺序拼接"),
    separator: z.string().optional().describe("片段之间的分隔符，默认换行"),
  }),
  execute: async (params) => {
    const { outputPath, parts, separator = "\n" } = params as {
      outputPath: string;
      parts: { type: string; content: string; deleteAfterMerge?: boolean }[];
      separator?: string;
    };

    if (!outputPath || String(outputPath).trim() === "") {
      return { success: false, message: "outputPath 不能为空" };
    }
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
      return { success: false, message: "parts 不能为空数组" };
    }

    try {
      const resolvedOutput = path.resolve(outputPath);
      const dir = path.dirname(resolvedOutput);
      await fs.mkdir(dir, { recursive: true });

      const chunks: string[] = [];
      const filesToDelete: string[] = [];

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part.type === "file") {
          const filePath = path.resolve(part.content);
          try {
            const content = await fs.readFile(filePath, "utf-8");
            chunks.push(content);
            if (part.deleteAfterMerge !== false && filePath !== resolvedOutput) {
              filesToDelete.push(filePath);
            }
          } catch (err) {
            return {
              success: false,
              message: `读取片段 ${i + 1} 失败 (${filePath}): ${err instanceof Error ? err.message : String(err)}`,
            };
          }
        } else {
          chunks.push(part.content);
        }
      }

      const merged = chunks.join(separator);
      await fs.writeFile(resolvedOutput, merged, "utf-8");

      for (const f of filesToDelete) {
        try { await fs.unlink(f); } catch { /* noop */ }
      }

      const stats = await fs.stat(resolvedOutput);
      const lines = merged.split("\n").length;

      return {
        success: true,
        message: `合并完成: ${path.basename(resolvedOutput)}\n片段数: ${parts.length}\n总行数: ${lines}\n文件大小: ${(stats.size / 1024).toFixed(1)}KB\n路径: ${resolvedOutput}`,
        data: {
          path: resolvedOutput,
          parts: parts.length,
          lines,
          size: stats.size,
          deletedFiles: filesToDelete,
        },
      };
    } catch (err) {
      return {
        success: false,
        message: `合并文件失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
