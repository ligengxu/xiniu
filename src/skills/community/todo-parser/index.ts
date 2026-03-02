import { z } from "zod";
import type { SkillDefinition } from "../types";

interface TodoItem {
  file: string;
  line: number;
  type: string;
  text: string;
  context: string;
}

const TODO_PATTERNS = [
  { type: "TODO", regex: /\/\/\s*TODO[:\s]+(.+)/i },
  { type: "TODO", regex: /#\s*TODO[:\s]+(.+)/i },
  { type: "FIXME", regex: /\/\/\s*FIXME[:\s]+(.+)/i },
  { type: "FIXME", regex: /#\s*FIXME[:\s]+(.+)/i },
  { type: "HACK", regex: /\/\/\s*HACK[:\s]+(.+)/i },
  { type: "HACK", regex: /#\s*HACK[:\s]+(.+)/i },
  { type: "XXX", regex: /\/\/\s*XXX[:\s]+(.+)/i },
  { type: "NOTE", regex: /\/\/\s*NOTE[:\s]+(.+)/i },
  { type: "NOTE", regex: /#\s*NOTE[:\s]+(.+)/i },
  { type: "WARN", regex: /\/\/\s*WARN(?:ING)?[:\s]+(.+)/i },
  { type: "DEPRECATED", regex: /\/\/\s*DEPRECATED[:\s]+(.+)/i },
];

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out",
  "__pycache__", ".venv", "venv", ".idea", ".vscode", "vendor",
  "coverage", ".turbo", ".cache", "target",
]);

const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h",
  ".cs", ".rb", ".php", ".swift", ".kt", ".scala", ".sh", ".bash", ".zsh",
  ".vue", ".svelte", ".astro", ".css", ".scss", ".less", ".sql", ".yaml", ".yml",
  ".toml", ".lua", ".r", ".dart", ".ex", ".exs", ".zig", ".nim",
]);

async function scanDir(
  dirPath: string, items: TodoItem[], maxFiles: number, scanned: { count: number },
): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");

  if (scanned.count >= maxFiles) return;

  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (scanned.count >= maxFiles) break;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await scanDir(path.join(dirPath, entry.name), items, maxFiles, scanned);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (!CODE_EXTS.has(ext)) continue;

      scanned.count++;
      const filePath = path.join(dirPath, entry.name);

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          for (const pat of TODO_PATTERNS) {
            const match = line.match(pat.regex);
            if (match) {
              items.push({
                file: filePath,
                line: i + 1,
                type: pat.type,
                text: match[1].trim(),
                context: line.trim(),
              });
              break;
            }
          }
        }
      } catch {}
    }
  }
}

export const todoParserSkill: SkillDefinition = {
  name: "todo_parser",
  displayName: "代码待办扫描",
  description:
    "扫描项目代码中的TODO/FIXME/HACK/NOTE等待办注释，按类型分组统计。" +
    "用户说'扫描TODO'、'代码待办'、'查找FIXME'、'待办扫描'时使用。",
  icon: "CheckSquare",
  category: "dev",
  parameters: z.object({
    projectPath: z.string().describe("项目根目录路径"),
    types: z.array(z.string()).optional().describe("筛选类型，如['TODO','FIXME']，不填则扫描全部"),
    maxFiles: z.number().optional().describe("最大扫描文件数，默认1000"),
    savePath: z.string().optional().describe("结果保存路径(JSON)"),
  }),
  execute: async (params) => {
    const { projectPath, types, maxFiles, savePath } = params as {
      projectPath: string; types?: string[]; maxFiles?: number; savePath?: string;
    };

    try {
      const fs = await import("fs");
      const path = await import("path");

      if (!fs.existsSync(projectPath)) return { success: false, message: `❌ 目录不存在: ${projectPath}` };

      const items: TodoItem[] = [];
      const limit = maxFiles || 1000;
      const scanned = { count: 0 };
      await scanDir(projectPath, items, limit, scanned);

      let filtered = items;
      if (types && types.length > 0) {
        const typeSet = new Set(types.map((t) => t.toUpperCase()));
        filtered = items.filter((i) => typeSet.has(i.type));
      }

      if (filtered.length === 0) {
        return { success: true, message: `📋 扫描完成\n━━━━━━━━━━━━━━━━━━━━\n扫描文件: ${scanned.count}\n待办项: 0\n\n✨ 代码很干净！` };
      }

      const grouped: Record<string, TodoItem[]> = {};
      for (const item of filtered) {
        if (!grouped[item.type]) grouped[item.type] = [];
        grouped[item.type].push(item);
      }

      const typeEmoji: Record<string, string> = {
        TODO: "📌", FIXME: "🐛", HACK: "⚠️", XXX: "❗",
        NOTE: "📝", WARN: "⚠️", DEPRECATED: "🚫",
      };

      let msg = `📋 代码待办扫描结果\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📊 扫描文件: ${scanned.count} | 待办项: ${filtered.length}\n\n`;

      for (const [type, list] of Object.entries(grouped)) {
        const emoji = typeEmoji[type] || "📌";
        msg += `${emoji} ${type} (${list.length}项)\n`;
        for (const item of list.slice(0, 10)) {
          const relPath = path.relative(projectPath, item.file).replace(/\\/g, "/");
          msg += `  ${relPath}:${item.line} — ${item.text}\n`;
        }
        if (list.length > 10) msg += `  ... 共 ${list.length} 项\n`;
        msg += `\n`;
      }

      if (savePath) {
        const dir = path.dirname(savePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(savePath, JSON.stringify(filtered, null, 2), "utf-8");
        msg += `📁 已保存: ${savePath}`;
      }

      return { success: true, message: msg, data: { total: filtered.length, scanned: scanned.count, types: grouped as unknown as Record<string, unknown> } };
    } catch (err) {
      return { success: false, message: `❌ 扫描失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
