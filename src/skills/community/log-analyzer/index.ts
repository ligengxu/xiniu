import { z } from "zod";
import type { SkillDefinition } from "../types";
import * as fs from "fs";
import * as path from "path";

interface LogEntry {
  line: number;
  level: string;
  timestamp?: string;
  message: string;
  raw: string;
}

const LEVEL_PATTERNS = [
  { regex: /\b(FATAL|CRITICAL)\b/i, level: "FATAL" },
  { regex: /\b(ERROR|ERR|SEVERE)\b/i, level: "ERROR" },
  { regex: /\b(WARN|WARNING)\b/i, level: "WARN" },
  { regex: /\b(INFO|NOTICE)\b/i, level: "INFO" },
  { regex: /\b(DEBUG|TRACE|VERBOSE)\b/i, level: "DEBUG" },
];

const TS_PATTERNS = [
  /(\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
  /(\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2})/,
  /(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/,
  /(\d{10,13})/,
];

function parseLine(raw: string, lineNum: number): LogEntry {
  let level = "UNKNOWN";
  for (const p of LEVEL_PATTERNS) {
    if (p.regex.test(raw)) { level = p.level; break; }
  }

  let timestamp: string | undefined;
  for (const p of TS_PATTERNS) {
    const m = raw.match(p);
    if (m) { timestamp = m[1]; break; }
  }

  return { line: lineNum, level, timestamp, message: raw.trim(), raw };
}

export const logAnalyzerSkill: SkillDefinition = {
  name: "log_analyzer",
  displayName: "日志分析器",
  description: "分析日志文件：统计错误/警告分布、提取错误摘要、按级别筛选、搜索关键词、时间范围过滤。支持 Nginx/Apache/应用日志等常见格式。用户说'日志分析'、'分析日志'、'查看错误日志'、'日志统计'、'log分析'时使用。",
  icon: "FileSearch",
  category: "dev",
  parameters: z.object({
    action: z.enum(["stats", "errors", "filter", "search", "top"]).describe("操作：stats=统计概览, errors=提取错误, filter=按级别筛选, search=关键词搜索, top=高频错误排行"),
    filePath: z.string().describe("日志文件路径"),
    level: z.string().optional().describe("日志级别筛选（filter）：ERROR/WARN/INFO/DEBUG/FATAL"),
    keyword: z.string().optional().describe("搜索关键词（search）"),
    limit: z.number().optional().describe("返回条数限制，默认50"),
  }),
  execute: async (params) => {
    const { action, filePath, level, keyword, limit: maxLines } = params as {
      action: string; filePath: string; level?: string; keyword?: string; limit?: number;
    };
    const limit = maxLines || 50;

    if (!fs.existsSync(filePath)) return { success: false, message: `❌ 文件不存在: ${filePath}` };

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const rawLines = content.split(/\r?\n/).filter(l => l.trim());
      const entries = rawLines.map((l, i) => parseLine(l, i + 1));

      if (action === "stats") {
        const levelCounts: Record<string, number> = {};
        for (const e of entries) {
          levelCounts[e.level] = (levelCounts[e.level] || 0) + 1;
        }

        const fileSize = fs.statSync(filePath).size;
        const sizeStr = fileSize > 1048576 ? (fileSize / 1048576).toFixed(1) + " MB" : (fileSize / 1024).toFixed(0) + " KB";

        const lines = [
          `📊 日志分析报告`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📁 文件: ${path.basename(filePath)}`,
          `💾 大小: ${sizeStr}`,
          `📝 总行数: ${entries.length}`,
          `\n📈 级别分布:`,
        ];

        const order = ["FATAL", "ERROR", "WARN", "INFO", "DEBUG", "UNKNOWN"];
        const emoji: Record<string, string> = { FATAL: "💀", ERROR: "❌", WARN: "⚠️", INFO: "ℹ️", DEBUG: "🔍", UNKNOWN: "❓" };
        for (const lv of order) {
          if (levelCounts[lv]) {
            const pct = ((levelCounts[lv] / entries.length) * 100).toFixed(1);
            lines.push(`  ${emoji[lv] || "📎"} ${lv}: ${levelCounts[lv]} (${pct}%)`);
          }
        }

        const timestamps = entries.filter(e => e.timestamp).map(e => e.timestamp!);
        if (timestamps.length > 0) {
          lines.push(`\n⏱️ 时间范围:`);
          lines.push(`  🕐 起始: ${timestamps[0]}`);
          lines.push(`  🕐 结束: ${timestamps[timestamps.length - 1]}`);
        }

        return { success: true, message: lines.join("\n"), data: { totalLines: entries.length, levelCounts } };
      }

      if (action === "errors") {
        const errorEntries = entries.filter(e => e.level === "ERROR" || e.level === "FATAL");
        const shown = errorEntries.slice(-limit);

        const lines = [`❌ 错误日志 (${errorEntries.length}条，显示最后${shown.length}条)`, `━━━━━━━━━━━━━━━━━━━━`];
        for (const e of shown) {
          const ts = e.timestamp ? `[${e.timestamp}] ` : "";
          lines.push(`L${e.line}: ${ts}${e.message.slice(0, 200)}`);
        }
        return { success: true, message: lines.join("\n"), data: { errorCount: errorEntries.length } };
      }

      if (action === "filter") {
        const targetLevel = (level || "ERROR").toUpperCase();
        const filtered = entries.filter(e => e.level === targetLevel);
        const shown = filtered.slice(-limit);

        const lines = [`🔍 ${targetLevel} 级别日志 (${filtered.length}条，显示最后${shown.length}条)`, `━━━━━━━━━━━━━━━━━━━━`];
        for (const e of shown) {
          const ts = e.timestamp ? `[${e.timestamp}] ` : "";
          lines.push(`L${e.line}: ${ts}${e.message.slice(0, 200)}`);
        }
        return { success: true, message: lines.join("\n"), data: { filteredCount: filtered.length } };
      }

      if (action === "search") {
        if (!keyword) return { success: false, message: "❌ search 需要 keyword 参数" };
        const kw = keyword.toLowerCase();
        const matches = entries.filter(e => e.raw.toLowerCase().includes(kw));
        const shown = matches.slice(0, limit);

        const lines = [`🔍 搜索 "${keyword}" (${matches.length}条匹配，显示前${shown.length}条)`, `━━━━━━━━━━━━━━━━━━━━`];
        for (const e of shown) {
          lines.push(`L${e.line} [${e.level}]: ${e.message.slice(0, 200)}`);
        }
        return { success: true, message: lines.join("\n"), data: { matchCount: matches.length } };
      }

      if (action === "top") {
        const errorEntries = entries.filter(e => e.level === "ERROR" || e.level === "FATAL");
        const msgCounts: Record<string, number> = {};
        for (const e of errorEntries) {
          const normalized = e.message.replace(/\d+/g, "N").replace(/0x[0-9a-f]+/gi, "0xN").slice(0, 150);
          msgCounts[normalized] = (msgCounts[normalized] || 0) + 1;
        }

        const sorted = Object.entries(msgCounts).sort((a, b) => b[1] - a[1]).slice(0, limit);
        const lines = [`🏆 高频错误 TOP${sorted.length}`, `━━━━━━━━━━━━━━━━━━━━`];
        sorted.forEach(([msg, count], i) => {
          lines.push(`${i + 1}. [${count}次] ${msg}`);
        });
        return { success: true, message: lines.join("\n"), data: { topErrors: sorted.length } };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ 日志分析异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
