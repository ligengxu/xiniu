import { z } from "zod";
import type { SkillDefinition } from "../types";

interface ToolCheck {
  name: string;
  command: string;
  versionFlag: string;
  category: string;
}

const TOOLS: ToolCheck[] = [
  { name: "Node.js", command: "node", versionFlag: "--version", category: "运行时" },
  { name: "npm", command: "npm", versionFlag: "--version", category: "包管理" },
  { name: "pnpm", command: "pnpm", versionFlag: "--version", category: "包管理" },
  { name: "yarn", command: "yarn", versionFlag: "--version", category: "包管理" },
  { name: "bun", command: "bun", versionFlag: "--version", category: "运行时" },
  { name: "Python", command: "python", versionFlag: "--version", category: "运行时" },
  { name: "pip", command: "pip", versionFlag: "--version", category: "包管理" },
  { name: "Go", command: "go", versionFlag: "version", category: "运行时" },
  { name: "Rust", command: "rustc", versionFlag: "--version", category: "运行时" },
  { name: "cargo", command: "cargo", versionFlag: "--version", category: "包管理" },
  { name: "Java", command: "java", versionFlag: "--version", category: "运行时" },
  { name: "Git", command: "git", versionFlag: "--version", category: "工具" },
  { name: "Docker", command: "docker", versionFlag: "--version", category: "容器" },
  { name: "docker-compose", command: "docker-compose", versionFlag: "--version", category: "容器" },
  { name: "kubectl", command: "kubectl", versionFlag: "version --client --short", category: "容器" },
  { name: "FFmpeg", command: "ffmpeg", versionFlag: "-version", category: "媒体" },
  { name: "adb", command: "adb", versionFlag: "version", category: "移动" },
  { name: "Tesseract", command: "tesseract", versionFlag: "--version", category: "OCR" },
  { name: "curl", command: "curl", versionFlag: "--version", category: "网络" },
  { name: "wget", command: "wget", versionFlag: "--version", category: "网络" },
];

async function checkTool(tool: ToolCheck): Promise<{ name: string; available: boolean; version: string; category: string }> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(execFile);

    const args = tool.versionFlag.split(" ");
    const { stdout, stderr } = await execAsync(tool.command, args, { timeout: 5000, windowsHide: true });
    const output = (stdout || stderr).trim();
    const version = output.split("\n")[0].slice(0, 80);
    return { name: tool.name, available: true, version, category: tool.category };
  } catch {
    return { name: tool.name, available: false, version: "", category: tool.category };
  }
}

export const envCheckerSkill: SkillDefinition = {
  name: "env_checker",
  displayName: "开发环境检查",
  description:
    "检查本机开发环境：已安装的运行时/包管理器/开发工具/容器等，显示版本信息。" +
    "用户说'环境检查'、'检查开发环境'、'哪些工具可用'、'版本检查'时使用。",
  icon: "Wrench",
  category: "dev",
  parameters: z.object({
    category: z.string().optional().describe("只检查指定分类: 运行时/包管理/工具/容器/媒体/移动/OCR/网络，不填检查全部"),
  }),
  execute: async (params) => {
    const { category } = params as { category?: string };

    try {
      let tools = TOOLS;
      if (category) {
        tools = TOOLS.filter((t) => t.category === category);
        if (tools.length === 0) {
          return { success: false, message: `❌ 未知分类: ${category}\n可用: ${[...new Set(TOOLS.map((t) => t.category))].join(", ")}` };
        }
      }

      const results = await Promise.all(tools.map(checkTool));
      const available = results.filter((r) => r.available);
      const missing = results.filter((r) => !r.available);

      const grouped: Record<string, typeof results> = {};
      for (const r of results) {
        if (!grouped[r.category]) grouped[r.category] = [];
        grouped[r.category].push(r);
      }

      let msg = `🔍 开发环境检查\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `✅ 可用: ${available.length} | ❌ 未安装: ${missing.length}\n\n`;

      for (const [cat, items] of Object.entries(grouped)) {
        msg += `📂 ${cat}\n`;
        for (const item of items) {
          if (item.available) {
            msg += `  ✅ ${item.name}: ${item.version}\n`;
          } else {
            msg += `  ❌ ${item.name}: 未安装\n`;
          }
        }
        msg += `\n`;
      }

      return {
        success: true, message: msg,
        data: { available: available.length, missing: missing.length, tools: results as unknown as Record<string, unknown>[] },
      };
    } catch (err) {
      return { success: false, message: `❌ 检查失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
