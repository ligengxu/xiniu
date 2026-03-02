import { z } from "zod";
import type { SkillDefinition } from "../types";

interface ClipEntry {
  id: number;
  content: string;
  timestamp: string;
  type: "text" | "image_path";
}

const history: ClipEntry[] = [];
let nextId = 1;
const MAX_HISTORY = 100;

function addEntry(content: string, type: "text" | "image_path" = "text"): ClipEntry {
  const entry: ClipEntry = {
    id: nextId++,
    content,
    timestamp: new Date().toISOString(),
    type,
  };
  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();
  return entry;
}

export const clipboardHistorySkill: SkillDefinition = {
  name: "clipboard_history",
  displayName: "剪贴板历史",
  description:
    "管理剪贴板历史记录：保存、查看、搜索、恢复之前复制的内容。" +
    "用户说'剪贴板历史'、'复制记录'、'粘贴历史'、'clipboard history'时使用。",
  icon: "ClipboardList",
  category: "office",
  parameters: z.object({
    action: z.enum(["save", "list", "get", "search", "clear", "read_current"]).describe("操作: save保存/list列表/get获取/search搜索/clear清空/read_current读取当前剪贴板"),
    content: z.string().optional().describe("save时要保存的内容 / search时的关键词"),
    id: z.number().optional().describe("get时的记录ID"),
    limit: z.number().optional().describe("list显示数量，默认20"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;
    const action = p.action as string;

    try {
      switch (action) {
        case "read_current": {
          const { execFile } = await import("child_process");
          const { promisify } = await import("util");
          const execAsync = promisify(execFile);
          try {
            const { stdout } = await execAsync("powershell", ["-Command", "Get-Clipboard"], { timeout: 5000, windowsHide: true });
            const text = stdout.trim();
            if (!text) return { success: true, message: "📋 剪贴板为空" };
            const entry = addEntry(text);
            return {
              success: true,
              message: `📋 当前剪贴板内容\n━━━━━━━━━━━━━━━━━━━━\n📝 已保存为 #${entry.id}\n\n${text.slice(0, 500)}${text.length > 500 ? "\n..." : ""}`,
              data: { id: entry.id, content: text },
            };
          } catch {
            return { success: false, message: "❌ 读取剪贴板失败（仅支持Windows）" };
          }
        }

        case "save": {
          if (!p.content) return { success: false, message: "❌ 请提供要保存的内容(content)" };
          const entry = addEntry(p.content as string);
          return {
            success: true,
            message: `✅ 已保存到历史 #${entry.id}\n📝 内容: ${(p.content as string).slice(0, 100)}${(p.content as string).length > 100 ? "..." : ""}`,
          };
        }

        case "list": {
          if (history.length === 0) return { success: true, message: "📋 剪贴板历史为空" };
          const limit = Math.min((p.limit as number) || 20, 50);
          const recent = history.slice(-limit).reverse();
          let msg = `📋 剪贴板历史\n━━━━━━━━━━━━━━━━━━━━\n📊 共 ${history.length} 条 | 显示最近 ${recent.length} 条\n\n`;
          for (const entry of recent) {
            const preview = entry.content.replace(/\n/g, " ").slice(0, 60);
            msg += `#${entry.id} [${entry.timestamp.slice(11, 19)}] ${preview}${entry.content.length > 60 ? "..." : ""}\n`;
          }
          return { success: true, message: msg };
        }

        case "get": {
          if (!p.id) return { success: false, message: "❌ 请提供记录ID(id)" };
          const entry = history.find((e) => e.id === (p.id as number));
          if (!entry) return { success: false, message: `❌ 未找到记录 #${p.id}` };

          try {
            const { execFile } = await import("child_process");
            const { promisify } = await import("util");
            const execAsync = promisify(execFile);
            await execAsync("powershell", ["-Command", `Set-Clipboard -Value '${entry.content.replace(/'/g, "''")}'`], { timeout: 5000, windowsHide: true });
          } catch { /* non-critical */ }

          return {
            success: true,
            message: `📋 记录 #${entry.id}\n━━━━━━━━━━━━━━━━━━━━\n⏰ ${entry.timestamp}\n\n${entry.content.slice(0, 1000)}`,
            data: { id: entry.id, content: entry.content },
          };
        }

        case "search": {
          if (!p.content) return { success: false, message: "❌ 请提供搜索关键词(content)" };
          const keyword = (p.content as string).toLowerCase();
          const matches = history.filter((e) => e.content.toLowerCase().includes(keyword));
          if (matches.length === 0) return { success: true, message: `🔍 未找到包含 "${p.content}" 的记录` };
          let msg = `🔍 搜索结果\n━━━━━━━━━━━━━━━━━━━━\n关键词: ${p.content} | 找到 ${matches.length} 条\n\n`;
          for (const entry of matches.slice(-20).reverse()) {
            const preview = entry.content.replace(/\n/g, " ").slice(0, 60);
            msg += `#${entry.id} [${entry.timestamp.slice(11, 19)}] ${preview}\n`;
          }
          return { success: true, message: msg };
        }

        case "clear": {
          const count = history.length;
          history.length = 0;
          return { success: true, message: `🗑️ 已清空 ${count} 条剪贴板历史` };
        }

        default:
          return { success: false, message: `❌ 未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `❌ 操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
