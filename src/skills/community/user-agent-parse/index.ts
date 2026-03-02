import { z } from "zod";
import type { SkillDefinition } from "../types";

interface UAInfo {
  browser: string;
  browserVersion: string;
  engine: string;
  os: string;
  osVersion: string;
  device: string;
  isMobile: boolean;
  isBot: boolean;
}

function parseUA(ua: string): UAInfo {
  const info: UAInfo = {
    browser: "Unknown", browserVersion: "", engine: "Unknown",
    os: "Unknown", osVersion: "", device: "Desktop",
    isMobile: false, isBot: false,
  };

  const bots = ["bot", "crawl", "spider", "slurp", "mediapartners", "lighthouse", "pagespeed", "headless"];
  if (bots.some(b => ua.toLowerCase().includes(b))) {
    info.isBot = true;
    info.device = "Bot";
    const botMatch = ua.match(/(Googlebot|Bingbot|Baiduspider|YandexBot|Slurp|DuckDuckBot|facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Lighthouse|HeadlessChrome)[/\s]?([\d.]*)/i);
    if (botMatch) { info.browser = botMatch[1]; info.browserVersion = botMatch[2] || ""; }
    else info.browser = "Bot";
  }

  if (ua.includes("Windows")) {
    info.os = "Windows";
    const m = ua.match(/Windows NT ([\d.]+)/);
    if (m) {
      const ver: Record<string, string> = { "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7", "6.0": "Vista", "5.1": "XP" };
      info.osVersion = ver[m[1]] || m[1];
    }
  } else if (ua.includes("Mac OS X") || ua.includes("macOS")) {
    info.os = "macOS";
    const m = ua.match(/Mac OS X ([\d_.]+)/);
    if (m) info.osVersion = m[1].replace(/_/g, ".");
  } else if (ua.includes("iPhone") || ua.includes("iPad")) {
    info.os = ua.includes("iPad") ? "iPadOS" : "iOS";
    info.isMobile = true;
    info.device = ua.includes("iPad") ? "Tablet" : "Mobile";
    const m = ua.match(/OS ([\d_]+)/);
    if (m) info.osVersion = m[1].replace(/_/g, ".");
  } else if (ua.includes("Android")) {
    info.os = "Android";
    info.isMobile = true;
    info.device = ua.includes("Tablet") || ua.includes("iPad") ? "Tablet" : "Mobile";
    const m = ua.match(/Android ([\d.]+)/);
    if (m) info.osVersion = m[1];
  } else if (ua.includes("Linux")) {
    info.os = "Linux";
    if (ua.includes("Ubuntu")) info.os = "Ubuntu";
    else if (ua.includes("Fedora")) info.os = "Fedora";
    else if (ua.includes("CentOS")) info.os = "CentOS";
  } else if (ua.includes("CrOS")) {
    info.os = "Chrome OS";
  }

  if (!info.isBot) {
    if (ua.includes("Edg/") || ua.includes("Edge/")) {
      info.browser = "Edge";
      const m = ua.match(/Edg(?:e)?\/([\d.]+)/);
      if (m) info.browserVersion = m[1];
      info.engine = "Blink";
    } else if (ua.includes("OPR/") || ua.includes("Opera")) {
      info.browser = "Opera";
      const m = ua.match(/OPR\/([\d.]+)/);
      if (m) info.browserVersion = m[1];
      info.engine = "Blink";
    } else if (ua.includes("Firefox/")) {
      info.browser = "Firefox";
      const m = ua.match(/Firefox\/([\d.]+)/);
      if (m) info.browserVersion = m[1];
      info.engine = "Gecko";
    } else if (ua.includes("Safari/") && !ua.includes("Chrome")) {
      info.browser = "Safari";
      const m = ua.match(/Version\/([\d.]+)/);
      if (m) info.browserVersion = m[1];
      info.engine = "WebKit";
    } else if (ua.includes("Chrome/")) {
      info.browser = "Chrome";
      const m = ua.match(/Chrome\/([\d.]+)/);
      if (m) info.browserVersion = m[1];
      info.engine = "Blink";
    } else if (ua.includes("MSIE") || ua.includes("Trident")) {
      info.browser = "IE";
      const m = ua.match(/(?:MSIE |rv:)([\d.]+)/);
      if (m) info.browserVersion = m[1];
      info.engine = "Trident";
    }

    const appBrowsers: [string, string][] = [
      ["MicroMessenger", "微信内置"],
      ["QQBrowser", "QQ浏览器"],
      ["UCBrowser", "UC浏览器"],
      ["MiuiBrowser", "小米浏览器"],
      ["HuaweiBrowser", "华为浏览器"],
      ["SamsungBrowser", "三星浏览器"],
      ["DingTalk", "钉钉"],
      ["Alipay", "支付宝"],
      ["baiduboxapp", "百度App"],
      ["Quark", "夸克"],
    ];
    for (const [key, name] of appBrowsers) {
      if (ua.includes(key)) {
        info.browser = name;
        const m = ua.match(new RegExp(`${key}[/\\s]?([\\d.]+)`));
        if (m) info.browserVersion = m[1];
        break;
      }
    }
  }

  return info;
}

export const userAgentParseSkill: SkillDefinition = {
  name: "user_agent_parse",
  displayName: "浏览器标识解析",
  description: "解析 User-Agent 字符串，识别浏览器、操作系统、设备类型、引擎、是否为爬虫。用户说'UA解析'、'User-Agent'、'浏览器识别'、'ua解析'、'user agent'、'设备识别'时使用。",
  icon: "Monitor",
  category: "dev",
  parameters: z.object({
    ua: z.string().describe("User-Agent 字符串"),
  }),
  execute: async (params) => {
    const { ua } = params as { ua: string };
    if (!ua?.trim()) return { success: false, message: "❌ 请提供 User-Agent 字符串" };

    try {
      const info = parseUA(ua);

      const lines = [
        `🔍 User-Agent 解析结果`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🌐 浏览器: ${info.browser}${info.browserVersion ? " " + info.browserVersion : ""}`,
        `⚙️ 引擎: ${info.engine}`,
        `💻 操作系统: ${info.os}${info.osVersion ? " " + info.osVersion : ""}`,
        `📱 设备类型: ${info.device}`,
        `📲 移动端: ${info.isMobile ? "是" : "否"}`,
        `🤖 爬虫: ${info.isBot ? "是" : "否"}`,
      ];

      return {
        success: true,
        message: lines.join("\n"),
        data: info as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return { success: false, message: `❌ UA 解析异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
