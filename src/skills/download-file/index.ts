import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

export const downloadFileSkill: SkillDefinition = {
  name: "download_file",
  displayName: "下载文件",
  description:
    "从指定URL下载文件到本地。用户可能会说'下载这个文件'、'保存文件'等。",
  icon: "Download",
  parameters: z.object({
    url: z.string().url().describe("文件下载URL"),
    savePath: z
      .string()
      .describe("保存到的本地文件完整路径（含文件名）"),
  }),
  execute: async (params) => {
    const { url, savePath } = params as {
      url: string;
      savePath: string;
    };

    const resolved = path.resolve(savePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!res.ok) {
        return {
          success: false,
          message: `下载失败: HTTP ${res.status} ${res.statusText}`,
        };
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(resolved, buffer);

      const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
      return {
        success: true,
        message: `文件已下载: ${resolved} (${sizeMB} MB)`,
        data: { path: resolved, size: buffer.length },
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};
