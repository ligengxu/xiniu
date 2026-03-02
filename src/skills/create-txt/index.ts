import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

export const createTxtSkill: SkillDefinition = {
  name: "create_txt",
  displayName: "创建/写入文件",
  description:
    "创建或覆盖写入任意文本文件（支持 .txt/.html/.css/.js/.json/.md/.py 等所有文本格式）。如果文件已存在则覆盖更新内容，不存在则新建。用户说'写文件'、'创建文件'、'更新文件'、'修改文件内容'时使用此工具。参数：filePath(路径) + content(内容)。",
  icon: "FileText",
  parameters: z.object({
    filePath: z
      .string()
      .describe("文件完整路径，支持任意扩展名，如 C:/Users/test/index.html"),
    content: z.string().optional().describe("文件内容（完整内容，会覆盖已有文件）"),
    contents: z.string().optional().describe("content 的别名，兼容用"),
  }),
  execute: async (params) => {
    const { filePath } = params as { filePath: string; content?: string; contents?: string };
    const content = (params as Record<string, unknown>).content as string
      ?? (params as Record<string, unknown>).contents as string
      ?? "";

    if (!content) {
      return { success: false, message: "content 不能为空（请传入 content 或 contents 参数）" };
    }
    if (!filePath || String(filePath).trim() === "") {
      return { success: false, message: "filePath 不能为空" };
    }
    try {
      const resolved = path.resolve(filePath);
      const dir = path.dirname(resolved);
      const ext = path.extname(resolved).slice(1).toLowerCase() || "txt";
      const fileName = path.basename(resolved);

      await fs.mkdir(dir, { recursive: true });

      let existed = false;
      try {
        await fs.access(resolved);
        existed = true;
      } catch {}

      await fs.writeFile(resolved, content, "utf-8");
      const stats = await fs.stat(resolved);
      const action = existed ? "已更新" : "已创建";
      const lineCount = content.split("\n").length;

      return {
        success: true,
        message: `✅ 文件${action}: ${resolved}\n📄 ${fileName} · ${ext.toUpperCase()} · ${lineCount} 行 · ${stats.size} 字节`,
        data: {
          path: resolved,
          fileName,
          extension: ext,
          size: stats.size,
          lines: lineCount,
          characters: content.length,
          action: existed ? "updated" : "created",
          directory: dir,
        },
      };
    } catch (err) {
      return {
        success: false,
        message: `写入文件失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
