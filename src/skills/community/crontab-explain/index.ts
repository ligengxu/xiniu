import { z } from "zod";
import type { SkillDefinition } from "../types";

const FIELD_NAMES = ["分钟", "小时", "日", "月", "星期"];
const FIELD_RANGES = [
  { min: 0, max: 59, name: "分钟" },
  { min: 0, max: 23, name: "小时" },
  { min: 1, max: 31, name: "日" },
  { min: 1, max: 12, name: "月" },
  { min: 0, max: 7, name: "星期" },
];

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六", "日"];
const MONTH_NAMES = ["", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function explainField(field: string, index: number): string {
  const range = FIELD_RANGES[index];
  const name = range.name;

  if (field === "*") return `每${name}`;
  if (field.includes("/")) {
    const [base, step] = field.split("/");
    const start = base === "*" ? range.min : parseInt(base);
    return `从第${start}${name}开始，每${step}${name}`;
  }
  if (field.includes("-")) {
    const [start, end] = field.split("-").map(Number);
    if (index === 4) return `周${WEEKDAY_NAMES[start]}到周${WEEKDAY_NAMES[end]}`;
    return `第${start}到第${end}${name}`;
  }
  if (field.includes(",")) {
    const values = field.split(",");
    if (index === 4) return `周${values.map((v) => WEEKDAY_NAMES[parseInt(v)] || v).join("、")}`;
    if (index === 3) return `${values.map((v) => MONTH_NAMES[parseInt(v)] || v + "月").join("、")}`;
    return `第${values.join("、")}${name}`;
  }

  const val = parseInt(field);
  if (index === 4) return `周${WEEKDAY_NAMES[val] || field}`;
  if (index === 3) return `${MONTH_NAMES[val] || field + "月"}`;
  return `第${field}${name}`;
}

function explainCron(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length < 5 || fields.length > 6) return "无效的Cron表达式（需要5或6个字段）";

  const parts = fields.slice(0, 5);
  const explanations = parts.map((f, i) => explainField(f, i));

  const shortcuts: Record<string, string> = {
    "* * * * *": "每分钟执行一次",
    "0 * * * *": "每小时整点执行",
    "0 0 * * *": "每天午夜执行",
    "0 0 * * 0": "每周日午夜执行",
    "0 0 1 * *": "每月1日午夜执行",
    "0 0 1 1 *": "每年1月1日午夜执行",
  };

  if (shortcuts[expression.trim()]) return shortcuts[expression.trim()];

  let desc = "";
  if (parts[4] !== "*") desc += explanations[4] + "的";
  if (parts[3] !== "*") desc += explanations[3] + "的";
  if (parts[2] !== "*") desc += explanations[2] + " ";
  if (parts[1] !== "*") desc += explanations[1].replace("第", "") + "点";
  else desc += "每小时";
  if (parts[0] !== "*") desc += explanations[0].replace("第", "").replace("分钟", "") + "分";
  else desc += "的每分钟";

  return desc + "执行";
}

function getNextRuns(expression: string, count: number): string[] {
  const fields = expression.trim().split(/\s+/).slice(0, 5);
  if (fields.length !== 5) return [];

  const results: string[] = [];
  const now = new Date();
  let current = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0);

  const matchField = (val: number, field: string, range: typeof FIELD_RANGES[0]): boolean => {
    if (field === "*") return true;
    if (field.includes("/")) {
      const [base, step] = field.split("/");
      const start = base === "*" ? range.min : parseInt(base);
      return (val - start) % parseInt(step) === 0 && val >= start;
    }
    if (field.includes(",")) return field.split(",").map(Number).includes(val);
    if (field.includes("-")) {
      const [s, e] = field.split("-").map(Number);
      return val >= s && val <= e;
    }
    return val === parseInt(field);
  };

  let maxIter = 525600; // 1 year of minutes
  while (results.length < count && maxIter-- > 0) {
    const minute = current.getMinutes();
    const hour = current.getHours();
    const day = current.getDate();
    const month = current.getMonth() + 1;
    const weekday = current.getDay();

    if (
      matchField(minute, fields[0], FIELD_RANGES[0]) &&
      matchField(hour, fields[1], FIELD_RANGES[1]) &&
      matchField(day, fields[2], FIELD_RANGES[2]) &&
      matchField(month, fields[3], FIELD_RANGES[3]) &&
      matchField(weekday, fields[4], FIELD_RANGES[4])
    ) {
      results.push(current.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }));
    }

    current = new Date(current.getTime() + 60000);
  }

  return results;
}

export const crontabExplainSkill: SkillDefinition = {
  name: "crontab_explain",
  displayName: "定时任务解读",
  description:
    "解读Cron表达式含义，展示未来触发时间。支持标准5/6字段格式。" +
    "用户说'cron解读'、'crontab'、'定时任务解读'、'解释cron'时使用。",
  icon: "AlarmClock",
  category: "dev",
  parameters: z.object({
    expression: z.string().describe("Cron表达式，如'0 9 * * *'"),
    nextCount: z.number().optional().describe("显示未来N次触发时间，默认5"),
  }),
  execute: async (params) => {
    const { expression, nextCount } = params as { expression: string; nextCount?: number };
    if (!expression?.trim()) return { success: false, message: "❌ 请提供Cron表达式" };

    const explanation = explainCron(expression);
    const count = Math.min(nextCount || 5, 20);
    const nextRuns = getNextRuns(expression, count);

    const fields = expression.trim().split(/\s+/);
    let msg = `⏰ Cron表达式解读\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📋 表达式: ${expression}\n`;
    msg += `📝 含义: ${explanation}\n\n`;
    msg += `📊 字段解析:\n`;
    for (let i = 0; i < Math.min(fields.length, 5); i++) {
      msg += `  ${FIELD_NAMES[i]}: ${fields[i]} → ${explainField(fields[i], i)}\n`;
    }

    if (nextRuns.length > 0) {
      msg += `\n🕐 未来${nextRuns.length}次触发:\n`;
      for (let i = 0; i < nextRuns.length; i++) msg += `  ${i + 1}. ${nextRuns[i]}\n`;
    }

    return { success: true, message: msg, data: { explanation, nextRuns } };
  },
};
