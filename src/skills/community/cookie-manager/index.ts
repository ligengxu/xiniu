import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";
import { getSessionPage, getSessionStatus, getOrRecoverPage } from "@/lib/puppeteer-render";

export const cookieManagerSkill: SkillDefinition = {
  name: "cookie_manager",
  displayName: "浏览器缓存管理",
  description:
    "管理浏览器页面的Cookie：读取所有Cookie、设置Cookie、删除Cookie、导出/导入Cookie（Netscape格式或JSON）、从Cookie中提取登录态Token。必须先用browser_open打开页面。用户说'cookie'、'登录态'、'导出cookie'、'导入cookie'时使用。",
  icon: "Braces",
  category: "dev",
  parameters: z.object({
    action: z.enum(["list", "get", "set", "delete", "clear", "export", "import", "extract_tokens"])
      .describe("操作: list=列出所有, get=读取指定, set=设置, delete=删除, clear=清空全部, export=导出, import=导入, extract_tokens=提取登录Token"),
    sessionId: z.string().optional().describe("浏览器会话ID，默认'main'"),
    name: z.string().optional().describe("Cookie名称(get/set/delete)"),
    value: z.string().optional().describe("set: Cookie值"),
    domain: z.string().optional().describe("set: Cookie域名"),
    cookiePath: z.string().optional().describe("set: Cookie路径，默认'/'"),
    httpOnly: z.boolean().optional().describe("set: HttpOnly标记"),
    secure: z.boolean().optional().describe("set: Secure标记"),
    expires: z.number().optional().describe("set: 过期时间(Unix时间戳秒)"),
    filePath: z.string().optional().describe("export/import: 文件路径(.json或.txt)"),
    format: z.string().optional().describe("export: json或netscape格式，默认json"),
    filterDomain: z.string().optional().describe("list/export: 按域名过滤"),
  }),
  execute: async (params) => {
    const {
      action, sessionId = "main",
      name, value, domain, cookiePath = "/",
      httpOnly, secure, expires,
      filePath, format = "json", filterDomain,
    } = params as {
      action: string; sessionId?: string;
      name?: string; value?: string; domain?: string; cookiePath?: string;
      httpOnly?: boolean; secure?: boolean; expires?: number;
      filePath?: string; format?: string; filterDomain?: string;
    };

    try {
      const page = await getOrRecoverPage(sessionId);
      if (!page) {
        const status = getSessionStatus(sessionId);
        let hint = `浏览器会话"${sessionId}"不存在且无法自动恢复`;
        if (status.allSessions.length > 0) hint += `，当前活跃会话: [${status.allSessions.join(", ")}]`;
        hint += "。请先使用 browser_open 打开页面";
        return { success: false, message: hint };
      }

      const client = await page.createCDPSession();

      switch (action) {
        case "list": {
          const resp = await client.send("Network.getAllCookies") as unknown as { cookies: Array<Record<string, unknown>> };
          const cookies = resp.cookies;
          let filtered = cookies;
          if (filterDomain) filtered = cookies.filter((c) => String(c.domain || "").includes(filterDomain));

          let msg = `Cookie列表 (${filtered.length}/${cookies.length})\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const c of filtered.slice(0, 80)) {
            const flags = [c.httpOnly ? "HttpOnly" : "", c.secure ? "Secure" : "", c.sameSite ? `SameSite=${c.sameSite}` : ""].filter(Boolean).join(" ");
            msg += `${c.name}=${String(c.value).slice(0, 80)}${String(c.value).length > 80 ? "..." : ""}\n  域: ${c.domain} | 路径: ${c.path} | ${flags}\n`;
          }
          if (filtered.length > 80) msg += `\n... 还有 ${filtered.length - 80} 个`;

          return { success: true, message: msg, data: { total: cookies.length, filtered: filtered.length, cookies: filtered.slice(0, 200) } };
        }

        case "get": {
          if (!name) return { success: false, message: "需要提供 name 参数" };
          const { cookies } = await client.send("Network.getAllCookies") as unknown as { cookies: Array<Record<string, unknown>> };
          const found = cookies.filter((c) => c.name === name);
          if (found.length === 0) return { success: false, message: `Cookie "${name}" 不存在` };

          let msg = `Cookie: ${name}\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const c of found) {
            msg += `值: ${c.value}\n域: ${c.domain}\n路径: ${c.path}\nHttpOnly: ${c.httpOnly}\nSecure: ${c.secure}\n`;
            if (c.expires) msg += `过期: ${new Date((c.expires as number) * 1000).toLocaleString()}\n`;
            msg += "\n";
          }

          return { success: true, message: msg, data: { cookies: found } };
        }

        case "set": {
          if (!name || !value) return { success: false, message: "需要提供 name 和 value 参数" };
          const pageUrl = new URL(page.url());
          const cookieDomain = domain || pageUrl.hostname;

          await client.send("Network.setCookie", {
            name,
            value,
            domain: cookieDomain,
            path: cookiePath,
            httpOnly: httpOnly || false,
            secure: secure || pageUrl.protocol === "https:",
            expires: expires || Math.floor(Date.now() / 1000) + 86400 * 365,
          });

          return {
            success: true,
            message: `Cookie已设置: ${name}=${value.slice(0, 50)}\n域: ${cookieDomain} | 路径: ${cookiePath}`,
            data: { name, domain: cookieDomain },
          };
        }

        case "delete": {
          if (!name) return { success: false, message: "需要提供 name 参数" };
          const { cookies: allCookies } = await client.send("Network.getAllCookies") as unknown as { cookies: Array<Record<string, unknown>> };
          const toDelete = allCookies.filter((c) => c.name === name);

          for (const c of toDelete) {
            await client.send("Network.deleteCookies", {
              name: String(c.name),
              domain: String(c.domain),
              path: String(c.path),
            });
          }

          return { success: true, message: `已删除 ${toDelete.length} 个名为 "${name}" 的Cookie` };
        }

        case "clear": {
          await client.send("Network.clearBrowserCookies");
          return { success: true, message: "所有Cookie已清空" };
        }

        case "export": {
          const { cookies } = await client.send("Network.getAllCookies") as unknown as { cookies: Array<Record<string, unknown>> };
          let filtered = cookies;
          if (filterDomain) filtered = cookies.filter((c) => String(c.domain || "").includes(filterDomain));

          let content: string;
          if (format === "netscape") {
            const lines = ["# Netscape HTTP Cookie File"];
            for (const c of filtered) {
              const httpOnlyPrefix = c.httpOnly ? "#HttpOnly_" : "";
              lines.push(`${httpOnlyPrefix}${c.domain}\t${String(c.domain).startsWith(".") ? "TRUE" : "FALSE"}\t${c.path}\t${c.secure ? "TRUE" : "FALSE"}\t${c.expires || 0}\t${c.name}\t${c.value}`);
            }
            content = lines.join("\n");
          } else {
            content = JSON.stringify(filtered, null, 2);
          }

          const outPath = path.resolve(filePath || `C:/Users/Administrator/Desktop/cookies_${Date.now()}.${format === "netscape" ? "txt" : "json"}`);
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, content, "utf-8");

          return {
            success: true,
            message: `已导出 ${filtered.length} 个Cookie到: ${outPath} (${format}格式)`,
            data: { path: outPath, count: filtered.length, format },
          };
        }

        case "import": {
          if (!filePath) return { success: false, message: "需要提供 filePath 参数" };
          const resolved = path.resolve(filePath);
          const content = await fs.readFile(resolved, "utf-8");

          let cookies: Array<Record<string, unknown>> = [];

          if (content.startsWith("[") || content.startsWith("{")) {
            const parsed = JSON.parse(content);
            cookies = Array.isArray(parsed) ? parsed : [parsed];
          } else {
            const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("# "));
            for (const line of lines) {
              const isHttpOnly = line.startsWith("#HttpOnly_");
              const cleanLine = isHttpOnly ? line.replace("#HttpOnly_", "") : line;
              const parts = cleanLine.split("\t");
              if (parts.length >= 7) {
                cookies.push({
                  domain: parts[0],
                  path: parts[2],
                  secure: parts[3] === "TRUE",
                  expires: parseInt(parts[4]) || undefined,
                  name: parts[5],
                  value: parts[6],
                  httpOnly: isHttpOnly,
                });
              }
            }
          }

          let imported = 0;
          for (const c of cookies) {
            try {
              await client.send("Network.setCookie", {
                name: String(c.name),
                value: String(c.value),
                domain: String(c.domain),
                path: String(c.path || "/"),
                httpOnly: Boolean(c.httpOnly),
                secure: Boolean(c.secure),
                expires: Number(c.expires) || Math.floor(Date.now() / 1000) + 86400 * 365,
              });
              imported++;
            } catch { /* skip invalid */ }
          }

          return {
            success: true,
            message: `已导入 ${imported}/${cookies.length} 个Cookie\n刷新页面后生效`,
            data: { imported, total: cookies.length },
          };
        }

        case "extract_tokens": {
          const { cookies } = await client.send("Network.getAllCookies") as unknown as { cookies: Array<Record<string, unknown>> };
          const tokenKeywords = ["token", "session", "sid", "auth", "jwt", "csrf", "xsrf", "login", "user", "sso", "access", "refresh", "ticket", "key", "credential"];

          const tokens = cookies.filter((c) => {
            const name = String(c.name).toLowerCase();
            return tokenKeywords.some((kw) => name.includes(kw));
          });

          if (tokens.length === 0) return { success: true, message: "未找到疑似登录态Token的Cookie" };

          let msg = `疑似登录态Token (${tokens.length}个)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const t of tokens) {
            const val = String(t.value);
            const isJwt = val.split(".").length === 3 && val.length > 50;
            msg += `${t.name} [${t.domain}]\n  值: ${val.slice(0, 100)}${val.length > 100 ? "..." : ""}\n`;
            if (isJwt) {
              msg += `  类型: JWT Token\n`;
              try {
                const payload = JSON.parse(Buffer.from(val.split(".")[1], "base64").toString());
                msg += `  JWT载荷: ${JSON.stringify(payload).slice(0, 300)}\n`;
                if (payload.exp) msg += `  过期: ${new Date(payload.exp * 1000).toLocaleString()}\n`;
              } catch { /* invalid jwt */ }
            }
            msg += "\n";
          }

          return { success: true, message: msg, data: { tokens } };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `Cookie操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
