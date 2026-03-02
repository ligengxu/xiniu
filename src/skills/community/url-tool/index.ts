import { z } from "zod";
import type { SkillDefinition } from "../types";

function parseUrlParts(urlStr: string): Record<string, unknown> | null {
  try {
    const u = new URL(urlStr);
    const params: Record<string, string> = {};
    u.searchParams.forEach((v, k) => { params[k] = v; });

    return {
      href: u.href,
      protocol: u.protocol,
      host: u.host,
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : ""),
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
      origin: u.origin,
      username: u.username || undefined,
      password: u.password || undefined,
      params: Object.keys(params).length > 0 ? params : undefined,
    };
  } catch {
    return null;
  }
}

export const urlToolSkill: SkillDefinition = {
  name: "url_tool",
  displayName: "网址编解码",
  description: "URL 编码/解码/解析。支持 URL 编解码、解析 URL 各部分（协议/域名/路径/参数）、构建 URL。用户说'URL编码'、'URL解码'、'解析URL'、'encodeURI'、'decodeURI'、'url encode'、'url decode'、'查询参数'时使用。",
  icon: "Link",
  category: "dev",
  parameters: z.object({
    action: z.enum(["encode", "decode", "parse", "build"]).describe("操作：encode=URL编码, decode=URL解码, parse=解析URL各部分, build=从参数构建URL"),
    value: z.string().describe("要处理的 URL 或字符串"),
    component: z.enum(["full", "component"]).optional().describe("encode 模式：full=encodeURI（保留URL结构字符）, component=encodeURIComponent（编码所有特殊字符）。默认 component"),
    params: z.record(z.string()).optional().describe("build 模式：要附加的查询参数键值对"),
  }),
  execute: async (params) => {
    const { action, value, component, params: queryParams } = params as {
      action: string; value: string; component?: string; params?: Record<string, string>;
    };

    try {
      if (action === "encode") {
        const mode = component || "component";
        const encoded = mode === "full" ? encodeURI(value) : encodeURIComponent(value);
        const lines = [
          `🔗 URL 编码`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📥 原文: ${value}`,
          `📤 编码: ${encoded}`,
          `📋 模式: ${mode === "full" ? "encodeURI（保留URL结构字符）" : "encodeURIComponent（编码所有特殊字符）"}`,
        ];
        return { success: true, message: lines.join("\n"), data: { input: value, encoded, mode } };
      }

      if (action === "decode") {
        let decoded: string;
        try {
          decoded = decodeURIComponent(value);
        } catch {
          try {
            decoded = decodeURI(value);
          } catch {
            return { success: false, message: `❌ 无法解码: ${value}` };
          }
        }

        let multiDecoded = decoded;
        let rounds = 1;
        for (let i = 0; i < 5; i++) {
          try {
            const next = decodeURIComponent(multiDecoded);
            if (next === multiDecoded) break;
            multiDecoded = next;
            rounds++;
          } catch {
            break;
          }
        }

        const lines = [
          `🔗 URL 解码`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📥 编码: ${value}`,
          `📤 解码: ${decoded}`,
        ];
        if (rounds > 1) {
          lines.push(`🔄 多层解码 (${rounds}层): ${multiDecoded}`);
        }
        return { success: true, message: lines.join("\n"), data: { input: value, decoded, multiDecoded: rounds > 1 ? multiDecoded : undefined, rounds } };
      }

      if (action === "parse") {
        const parts = parseUrlParts(value);
        if (!parts) {
          return { success: false, message: `❌ 无效的 URL: ${value}` };
        }
        const p = parts.params as Record<string, string> | undefined;
        const lines = [
          `🔗 URL 解析`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `🌐 完整 URL: ${parts.href}`,
          `📡 协议: ${parts.protocol}`,
          `🖥️ 主机: ${parts.host}`,
          `🏷️ 域名: ${parts.hostname}`,
          `🚪 端口: ${parts.port}`,
          `📂 路径: ${parts.pathname}`,
        ];
        if (parts.search) lines.push(`🔍 查询串: ${parts.search}`);
        if (parts.hash) lines.push(`#️⃣ 锚点: ${parts.hash}`);
        if (parts.username) lines.push(`👤 用户名: ${parts.username}`);
        if (p) {
          lines.push(`\n📋 查询参数 (${Object.keys(p).length}个):`);
          for (const [k, v] of Object.entries(p)) {
            lines.push(`  ${k} = ${v}`);
          }
        }
        return { success: true, message: lines.join("\n"), data: parts };
      }

      if (action === "build") {
        try {
          const u = new URL(value);
          if (queryParams) {
            for (const [k, v] of Object.entries(queryParams)) {
              u.searchParams.set(k, v);
            }
          }
          const lines = [
            `🔗 URL 构建`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `📥 基础 URL: ${value}`,
            `📋 附加参数: ${queryParams ? Object.entries(queryParams).map(([k, v]) => `${k}=${v}`).join(", ") : "无"}`,
            `📤 完整 URL: ${u.href}`,
          ];
          return { success: true, message: lines.join("\n"), data: { base: value, params: queryParams, result: u.href } };
        } catch {
          return { success: false, message: `❌ 无效的基础 URL: ${value}` };
        }
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ URL 处理异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
