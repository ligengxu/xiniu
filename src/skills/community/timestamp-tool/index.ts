import { z } from "zod";
import type { SkillDefinition } from "../types";

function formatDate(d: Date, tz?: string): string {
  try {
    return d.toLocaleString("zh-CN", {
      timeZone: tz || "Asia/Shanghai",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
  } catch {
    return d.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
  }
}

function getRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const absDiff = Math.abs(diff);
  const future = diff < 0;
  const prefix = future ? "距现在还有 " : "";
  const suffix = future ? "" : "前";

  if (absDiff < 60_000) return `${prefix}${Math.floor(absDiff / 1000)} 秒${suffix}`;
  if (absDiff < 3_600_000) return `${prefix}${Math.floor(absDiff / 60_000)} 分钟${suffix}`;
  if (absDiff < 86_400_000) return `${prefix}${Math.floor(absDiff / 3_600_000)} 小时${suffix}`;
  if (absDiff < 2_592_000_000) return `${prefix}${Math.floor(absDiff / 86_400_000)} 天${suffix}`;
  if (absDiff < 31_536_000_000) return `${prefix}${Math.floor(absDiff / 2_592_000_000)} 个月${suffix}`;
  return `${prefix}${(absDiff / 31_536_000_000).toFixed(1)} 年${suffix}`;
}

function getDayOfWeek(d: Date): string {
  const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return days[d.getDay()];
}

function parseTimestamp(input: string): number | null {
  const trimmed = input.trim();

  const num = Number(trimmed);
  if (Number.isFinite(num) && num > 0) {
    if (num < 1e12) return num * 1000;
    if (num < 1e15) return num;
    if (num < 1e18) return Math.floor(num / 1000);
  }

  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) return d.getTime();

  const cnMatch = trimmed.match(/^(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})[日]?\s*(\d{1,2})?[时:.]?(\d{1,2})?[分:.]?(\d{1,2})?[秒]?$/);
  if (cnMatch) {
    const [, y, m, day, h, min, s] = cnMatch;
    const date = new Date(Number(y), Number(m) - 1, Number(day), Number(h || 0), Number(min || 0), Number(s || 0));
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }

  return null;
}

export const timestampToolSkill: SkillDefinition = {
  name: "timestamp_tool",
  displayName: "时间戳转换",
  description: "时间戳与日期时间互转。支持秒级/毫秒级/微秒级时间戳转日期，日期字符串转时间戳，获取当前时间戳。用户说'时间戳'、'转时间'、'转日期'、'timestamp'、'unix时间'、'当前时间戳'时使用。",
  icon: "Clock",
  category: "dev",
  parameters: z.object({
    action: z.enum(["to_date", "to_timestamp", "now", "diff"]).describe("操作：to_date=时间戳转日期, to_timestamp=日期转时间戳, now=当前时间戳, diff=计算两个时间差"),
    value: z.string().optional().describe("时间戳数字或日期字符串，action=now时可不传"),
    value2: z.string().optional().describe("第二个时间值（action=diff时使用）"),
    timezone: z.string().optional().describe("时区，如 Asia/Shanghai、America/New_York，默认 Asia/Shanghai"),
  }),
  execute: async (params) => {
    const { action, value, value2, timezone } = params as {
      action: string; value?: string; value2?: string; timezone?: string;
    };
    const tz = timezone || "Asia/Shanghai";

    try {
      if (action === "now") {
        const now = Date.now();
        const d = new Date(now);
        const lines = [
          `🕐 当前时间`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📅 日期时间: ${formatDate(d, tz)} ${getDayOfWeek(d)}`,
          `⏱️ 秒级时间戳: ${Math.floor(now / 1000)}`,
          `⏱️ 毫秒级时间戳: ${now}`,
          `🌍 时区: ${tz}`,
          `📆 ISO 8601: ${d.toISOString()}`,
          `📆 UTC: ${d.toUTCString()}`,
        ];
        return {
          success: true,
          message: lines.join("\n"),
          data: {
            timestamp_s: Math.floor(now / 1000),
            timestamp_ms: now,
            datetime: formatDate(d, tz),
            iso: d.toISOString(),
            dayOfWeek: getDayOfWeek(d),
          },
        };
      }

      if (action === "to_date") {
        if (!value) return { success: false, message: "❌ 请提供时间戳数字" };
        const ts = parseTimestamp(value);
        if (!ts) return { success: false, message: `❌ 无法解析时间戳: ${value}` };
        const d = new Date(ts);
        const lines = [
          `🕐 时间戳 → 日期`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📥 输入: ${value}`,
          `📅 日期时间: ${formatDate(d, tz)} ${getDayOfWeek(d)}`,
          `🕑 相对时间: ${getRelativeTime(ts)}`,
          `🌍 时区: ${tz}`,
          `📆 ISO 8601: ${d.toISOString()}`,
        ];
        return {
          success: true,
          message: lines.join("\n"),
          data: { input: value, timestamp_ms: ts, datetime: formatDate(d, tz), iso: d.toISOString(), relative: getRelativeTime(ts) },
        };
      }

      if (action === "to_timestamp") {
        if (!value) return { success: false, message: "❌ 请提供日期时间字符串" };
        const ts = parseTimestamp(value);
        if (!ts) return { success: false, message: `❌ 无法解析日期: ${value}\n支持的格式：2025-01-01 12:00:00、2025年1月1日 12时、ISO 8601 等` };
        const lines = [
          `🕐 日期 → 时间戳`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📥 输入: ${value}`,
          `⏱️ 秒级时间戳: ${Math.floor(ts / 1000)}`,
          `⏱️ 毫秒级时间戳: ${ts}`,
          `🕑 相对时间: ${getRelativeTime(ts)}`,
        ];
        return {
          success: true,
          message: lines.join("\n"),
          data: { input: value, timestamp_s: Math.floor(ts / 1000), timestamp_ms: ts, relative: getRelativeTime(ts) },
        };
      }

      if (action === "diff") {
        if (!value || !value2) return { success: false, message: "❌ 计算时间差需要两个时间值（value 和 value2）" };
        const ts1 = parseTimestamp(value);
        const ts2 = parseTimestamp(value2);
        if (!ts1) return { success: false, message: `❌ 无法解析第一个时间: ${value}` };
        if (!ts2) return { success: false, message: `❌ 无法解析第二个时间: ${value2}` };

        const diffMs = Math.abs(ts2 - ts1);
        const days = Math.floor(diffMs / 86_400_000);
        const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
        const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
        const seconds = Math.floor((diffMs % 60_000) / 1000);

        const lines = [
          `🕐 时间差计算`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📅 时间1: ${formatDate(new Date(ts1), tz)}`,
          `📅 时间2: ${formatDate(new Date(ts2), tz)}`,
          `⏱️ 相差: ${days} 天 ${hours} 小时 ${minutes} 分钟 ${seconds} 秒`,
          `⏱️ 总秒数: ${Math.floor(diffMs / 1000).toLocaleString()}`,
          `⏱️ 总毫秒: ${diffMs.toLocaleString()}`,
        ];
        return {
          success: true,
          message: lines.join("\n"),
          data: { time1: formatDate(new Date(ts1), tz), time2: formatDate(new Date(ts2), tz), diff_days: days, diff_hours: hours, diff_minutes: minutes, diff_seconds: seconds, diff_total_ms: diffMs },
        };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ 时间戳转换异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
