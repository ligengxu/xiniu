import { z } from "zod";
import type { SkillDefinition } from "../types";

const FIELD_NAMES = ["秒", "分", "时", "日", "月", "周"];
const FIELD_RANGES: Array<[number, number]> = [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const MONTH_NAMES = ["", "一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
const DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六", "日"];

function explainField(field: string, idx: number): string {
  const name = FIELD_NAMES[idx];
  const [min, max] = FIELD_RANGES[idx];

  if (field === "*") return `每${name}`;

  if (/^\d+$/.test(field)) {
    const n = parseInt(field);
    if (idx === 4) return `${MONTH_NAMES[n] || n}月`;
    if (idx === 5) return `周${DAY_NAMES[n] || n}`;
    return `第${n}${name}`;
  }

  if (/^\*\/(\d+)$/.test(field)) {
    const step = parseInt(field.split("/")[1]);
    return `每隔${step}${name}`;
  }

  if (field.includes(",")) {
    const parts = field.split(",").map((p) => {
      if (idx === 5) return `周${DAY_NAMES[parseInt(p)] || p}`;
      return p;
    });
    return `${name}在 ${parts.join("、")}`;
  }

  if (field.includes("-")) {
    const [a, b] = field.split("-");
    if (idx === 5) return `周${DAY_NAMES[parseInt(a)] || a}到周${DAY_NAMES[parseInt(b)] || b}`;
    return `${name}${a}到${b}`;
  }

  if (field === "?" && (idx === 3 || idx === 5)) return `不指定${name}`;
  if (field === "L" && idx === 3) return "每月最后一天";
  if (field === "W" && idx === 3) return "最近工作日";

  return `${name}=${field}`;
}

function parseCron(expression: string): { ok: boolean; explanation: string; fields: string[] } {
  const parts = expression.trim().split(/\s+/);

  if (parts.length === 5) {
    parts.unshift("0");
  }

  if (parts.length !== 6 && parts.length !== 7) {
    return { ok: false, explanation: `无效的Cron表达式: 需要5-7个字段，当前${parts.length}个`, fields: parts };
  }

  const explanations = parts.slice(0, 6).map((f, i) => explainField(f, i));
  const summary = explanations.filter((e) => !e.startsWith("每") || e !== "每秒").join(" ");

  return { ok: true, explanation: summary, fields: parts };
}

function getNextRuns(expression: string, count: number): string[] {
  const parts = expression.trim().split(/\s+/);
  if (parts.length === 5) parts.unshift("0");
  if (parts.length < 6) return [];

  const results: string[] = [];
  const now = new Date();
  const current = new Date(now);

  for (let attempt = 0; attempt < 10000 && results.length < count; attempt++) {
    current.setSeconds(current.getSeconds() + 1);

    const sec = current.getSeconds();
    const min = current.getMinutes();
    const hour = current.getHours();
    const day = current.getDate();
    const month = current.getMonth() + 1;
    const dow = current.getDay();

    if (matchField(parts[0], sec, 0) && matchField(parts[1], min, 1) &&
        matchField(parts[2], hour, 2) && matchField(parts[3], day, 3) &&
        matchField(parts[4], month, 4) && matchField(parts[5], dow, 5)) {
      results.push(current.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }));
      current.setSeconds(current.getSeconds() + 59);
    }
  }

  return results;
}

function matchField(field: string, value: number, idx: number): boolean {
  if (field === "*" || field === "?") return true;

  if (/^\d+$/.test(field)) {
    const n = parseInt(field);
    if (idx === 5 && n === 7) return value === 0;
    return value === n;
  }

  if (/^\*\/(\d+)$/.test(field)) {
    const step = parseInt(field.split("/")[1]);
    return value % step === 0;
  }

  if (field.includes(",")) {
    return field.split(",").some((p) => matchField(p.trim(), value, idx));
  }

  if (field.includes("-")) {
    const [a, b] = field.split("-").map(Number);
    return value >= a && value <= b;
  }

  return false;
}

interface CronPreset {
  name: string;
  expression: string;
  description: string;
}

const PRESETS: CronPreset[] = [
  { name: "每分钟", expression: "* * * * *", description: "每分钟执行一次" },
  { name: "每5分钟", expression: "*/5 * * * *", description: "每5分钟执行一次" },
  { name: "每小时", expression: "0 * * * *", description: "每小时整点执行" },
  { name: "每天零点", expression: "0 0 * * *", description: "每天凌晨0:00执行" },
  { name: "每天早上9点", expression: "0 9 * * *", description: "每天上午9:00执行" },
  { name: "每周一早9点", expression: "0 9 * * 1", description: "每周一上午9:00执行" },
  { name: "每月1号零点", expression: "0 0 1 * *", description: "每月1号凌晨0:00执行" },
  { name: "工作日早9点", expression: "0 9 * * 1-5", description: "周一到周五上午9:00执行" },
  { name: "每天8点和20点", expression: "0 8,20 * * *", description: "每天上午8:00和晚上20:00执行" },
  { name: "每季度首日", expression: "0 0 1 1,4,7,10 *", description: "1/4/7/10月1日凌晨执行" },
  { name: "每30秒", expression: "*/30 * * * * *", description: "每30秒执行一次(6位)" },
  { name: "每天凌晨2点", expression: "0 2 * * *", description: "每天凌晨2:00执行(备份常用)" },
];

export const cronExpressionSkill: SkillDefinition = {
  name: "cron_expression",
  displayName: "定时表达式工具",
  description: "Cron表达式生成、解析和验证。支持5位(标准)和6位(含秒)格式。可解释含义、预览未来执行时间、根据描述生成表达式、列出常用预设。用户说'cron'、'定时表达式'、'crontab'时使用。",
  icon: "Clock",
  category: "dev",
  parameters: z.object({
    action: z.enum(["parse", "generate", "presets", "validate"])
      .describe("操作: parse=解析表达式, generate=根据描述生成, presets=列出常用预设, validate=验证表达式"),
    expression: z.string().optional().describe("parse/validate操作的Cron表达式"),
    description: z.string().optional().describe("generate操作的自然语言描述(如'每天早上9点')"),
    showNextRuns: z.number().optional().describe("显示未来N次执行时间，默认5"),
  }),
  execute: async (params) => {
    const { action, expression, description, showNextRuns = 5 } = params as {
      action: string; expression?: string; description?: string; showNextRuns?: number;
    };

    try {
      switch (action) {
        case "parse":
        case "validate": {
          if (!expression) return { success: false, message: "需要提供 expression 参数" };
          const result = parseCron(expression);

          if (!result.ok) return { success: false, message: result.explanation };

          let msg = `Cron表达式解析\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `表达式: ${expression}\n`;
          msg += `含义: ${result.explanation}\n`;
          msg += `字段: ${result.fields.map((f, i) => `${FIELD_NAMES[i]}=${f}`).join(" | ")}\n`;

          const nextRuns = getNextRuns(expression, showNextRuns);
          if (nextRuns.length > 0) {
            msg += `\n未来${nextRuns.length}次执行:\n`;
            nextRuns.forEach((t, i) => { msg += `  ${i + 1}. ${t}\n`; });
          }

          return {
            success: true, message: msg,
            data: { expression, explanation: result.explanation, fields: result.fields, nextRuns },
          };
        }

        case "generate": {
          if (!description) return { success: false, message: "需要提供 description 参数" };

          const desc = description.toLowerCase();
          let matched: CronPreset | undefined;

          for (const preset of PRESETS) {
            if (desc.includes(preset.name) || preset.description.includes(desc)) {
              matched = preset;
              break;
            }
          }

          if (!matched) {
            const hourMatch = desc.match(/每天.*?(\d{1,2})\s*[点时]/);
            if (hourMatch) {
              const h = parseInt(hourMatch[1]);
              matched = { name: `每天${h}点`, expression: `0 ${h} * * *`, description: `每天${h}:00执行` };
            }

            const minMatch = desc.match(/每\s*(\d+)\s*分钟/);
            if (!matched && minMatch) {
              const m = parseInt(minMatch[1]);
              matched = { name: `每${m}分钟`, expression: `*/${m} * * * *`, description: `每${m}分钟执行` };
            }

            const secMatch = desc.match(/每\s*(\d+)\s*秒/);
            if (!matched && secMatch) {
              const s = parseInt(secMatch[1]);
              matched = { name: `每${s}秒`, expression: `*/${s} * * * * *`, description: `每${s}秒执行` };
            }
          }

          if (!matched) {
            let msg = `无法精确匹配"${description}"，以下是常用预设:\n━━━━━━━━━━━━━━━━━━━━\n`;
            PRESETS.forEach((p) => { msg += `${p.expression.padEnd(20)} ${p.name} — ${p.description}\n`; });
            return { success: true, message: msg, data: { presets: PRESETS } };
          }

          const nextRuns = getNextRuns(matched.expression, showNextRuns);
          let msg = `Cron表达式生成\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `描述: ${description}\n`;
          msg += `表达式: ${matched.expression}\n`;
          msg += `含义: ${matched.description}\n`;
          if (nextRuns.length > 0) {
            msg += `\n未来${nextRuns.length}次执行:\n`;
            nextRuns.forEach((t, i) => { msg += `  ${i + 1}. ${t}\n`; });
          }

          return { success: true, message: msg, data: { expression: matched.expression, description: matched.description, nextRuns } };
        }

        case "presets": {
          let msg = `常用Cron预设\n━━━━━━━━━━━━━━━━━━━━\n`;
          PRESETS.forEach((p) => { msg += `${p.expression.padEnd(22)} ${p.name} — ${p.description}\n`; });
          return { success: true, message: msg, data: { presets: PRESETS } };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `Cron处理异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
