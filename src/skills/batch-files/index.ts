import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

export const batchFilesSkill: SkillDefinition = {
  name: "batch_files",
  displayName: "批量文件操作",
  description:
    "批量重命名、移动、复制或删除文件。用户可能会说'批量重命名'、'整理文件'、'批量操作'等。",
  icon: "Files",
  category: "life",
  parameters: z.object({
    action: z.enum(["rename", "move", "copy", "delete"]).describe("操作类型: rename, move, copy, delete"),
    sourcePaths: z.array(z.string()).describe("源文件路径数组"),
    destDir: z.string().optional().describe("目标目录（move/copy时需要）"),
    prefix: z.string().optional().describe("重命名前缀（rename时可用）"),
    suffix: z.string().optional().describe("重命名后缀（rename时可用）"),
  }),
  execute: async (params) => {
    const { action, sourcePaths, destDir, prefix, suffix } = params as {
      action: "rename" | "move" | "copy" | "delete";
      sourcePaths: string[];
      destDir?: string;
      prefix?: string;
      suffix?: string;
    };

    if (!sourcePaths || !Array.isArray(sourcePaths) || sourcePaths.length === 0) {
      return { success: false, message: "sourcePaths 不能为空数组" };
    }

    try {
      let successCount = 0;
      let failCount = 0;
      const errors: string[] = [];

      for (const srcPath of sourcePaths) {
        try {
          const resolved = path.resolve(srcPath);
          const basename = path.basename(resolved);
          const ext = path.extname(basename);
          const nameWithoutExt = path.basename(basename, ext);

          switch (action) {
            case "rename": {
              const newName = `${prefix || ""}${nameWithoutExt}${suffix || ""}${ext}`;
              const newPath = path.join(path.dirname(resolved), newName);
              await fs.rename(resolved, newPath);
              break;
            }
            case "move": {
              if (!destDir) throw new Error("move操作需要指定destDir");
              const dest = path.resolve(destDir, basename);
              await fs.mkdir(path.resolve(destDir), { recursive: true });
              await fs.rename(resolved, dest);
              break;
            }
            case "copy": {
              if (!destDir) throw new Error("copy操作需要指定destDir");
              const dest = path.resolve(destDir, basename);
              await fs.mkdir(path.resolve(destDir), { recursive: true });
              await fs.cp(resolved, dest, { recursive: true });
              break;
            }
            case "delete": {
              const stats = await fs.stat(resolved);
              await fs.rm(resolved, { recursive: stats.isDirectory() });
              break;
            }
          }
          successCount++;
        } catch (err) {
          failCount++;
          errors.push(`${path.basename(srcPath)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const actionNames = { rename: "重命名", move: "移动", copy: "复制", delete: "删除" };
      const msg = `批量${actionNames[action]}完成: 成功 ${successCount} 个，失败 ${failCount} 个`;

      return {
        success: failCount === 0,
        message: errors.length > 0 ? `${msg}\n失败详情:\n${errors.join("\n")}` : msg,
        data: { successCount, failCount, total: sourcePaths.length },
      };
    } catch (err) {
      return {
        success: false,
        message: `批量操作异常: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
