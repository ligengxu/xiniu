import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

export const createFolderSkill: SkillDefinition = {
  name: "create_folder",
  displayName: "创建文件夹",
  description:
    "在指定路径创建一个新的文件夹。用户可能会说'创建目录'、'新建文件夹'等。",
  icon: "FolderPlus",
  parameters: z.object({
    folderPath: z
      .string()
      .describe("要创建的文件夹完整路径，例如 C:/Users/test/新文件夹"),
  }),
  execute: async (params) => {
    const { folderPath } = params as { folderPath: string };
    if (!folderPath || String(folderPath).trim() === "") {
      return { success: false, message: "folderPath 不能为空" };
    }
    try {
      const resolved = path.resolve(folderPath);
      await fs.mkdir(resolved, { recursive: true });
      return {
        success: true,
        message: `文件夹已创建: ${resolved}`,
        data: { path: resolved },
      };
    } catch (err) {
      return {
        success: false,
        message: `创建文件夹失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
