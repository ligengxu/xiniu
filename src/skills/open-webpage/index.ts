import { z } from "zod";
import { exec } from "child_process";
import path from "path";
import type { SkillDefinition } from "../types";

export const openWebpageSkill: SkillDefinition = {
  name: "open_webpage",
  displayName: "打开网页/文件",
  description:
    "在系统默认浏览器中打开网页URL或本地HTML文件。支持 http/https 链接和本地文件路径（如 C:/Users/test/index.html）。",
  icon: "ExternalLink",
  parameters: z.object({
    url: z.string().describe("要打开的网页URL或本地文件路径（如 C:/Users/xxx/file.html）"),
  }),
  execute: async (params) => {
    const { url } = params as { url: string };

    const isLocalFile = !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("file:///");
    let finalUrl = url;

    if (isLocalFile) {
      const resolved = path.resolve(url);
      finalUrl = "file:///" + resolved.replace(/\\/g, "/");
    }

    try {
      const platform = process.platform;
      let cmd: string;
      if (platform === "win32") {
        cmd = `start "" "${finalUrl}"`;
      } else if (platform === "darwin") {
        cmd = `open "${finalUrl}"`;
      } else {
        cmd = `xdg-open "${finalUrl}"`;
      }

      await new Promise<void>((resolve, reject) => {
        exec(cmd, { timeout: 10000 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return {
        success: true,
        message: `已在系统浏览器中打开: ${finalUrl}`,
        data: { url: finalUrl, action: "open_in_browser", openedBySystem: true },
      };
    } catch {
      return {
        success: true,
        message: `请在浏览器中打开: ${finalUrl}`,
        data: { url: finalUrl, action: "open_in_browser", openedBySystem: false },
      };
    }
  },
};
