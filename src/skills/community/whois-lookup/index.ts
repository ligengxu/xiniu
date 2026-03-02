import { z } from "zod";
import type { SkillDefinition } from "../types";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function queryWhoisCmd(domain: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`whois ${domain}`, { timeout: 15000 });
    return stdout;
  } catch {
    return null;
  }
}

async function queryWhoisApi(domain: string): Promise<Record<string, string> | null> {
  const apis = [
    {
      url: `https://da.gd/w/${encodeURIComponent(domain)}`,
      parse: (text: string) => {
        const result: Record<string, string> = {};
        for (const line of text.split("\n")) {
          const match = line.match(/^\s*(.+?):\s*(.+)$/);
          if (match) {
            const key = match[1].trim().toLowerCase();
            const val = match[2].trim();
            if (!result[key] && val) result[key] = val;
          }
        }
        return Object.keys(result).length > 0 ? result : null;
      },
    },
  ];

  for (const api of apis) {
    try {
      const resp = await fetch(api.url, {
        headers: { "User-Agent": "curl/7.68.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;
      const text = await resp.text();
      const parsed = api.parse(text);
      if (parsed) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function extractWhoisFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const keys = [
    "domain name", "registrar", "registrar url", "creation date", "updated date",
    "registry expiry date", "expiration date", "name server", "registrant",
    "registrant organization", "registrant country", "dnssec", "status",
    "domain status",
  ];

  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*(.+?):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const val = match[2].trim();
    if (keys.some(k => key.includes(k)) && !fields[key] && val) {
      fields[key] = val;
    }
  }
  return fields;
}

export const whoisLookupSkill: SkillDefinition = {
  name: "whois_lookup",
  displayName: "域名注册查询",
  description: "查询域名的 Whois 注册信息，包括注册商、注册日期、到期日期、DNS 服务器等。用户说'whois'、'域名查询'、'域名注册信息'、'域名到期'、'域名所有者'时使用。",
  icon: "Search",
  category: "dev",
  parameters: z.object({
    domain: z.string().describe("要查询的域名，如 example.com"),
  }),
  execute: async (params) => {
    const { domain } = params as { domain: string };
    if (!domain?.trim()) return { success: false, message: "❌ 请提供域名" };

    const cleanDomain = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();

    try {
      const cmdResult = await queryWhoisCmd(cleanDomain);
      if (cmdResult && cmdResult.length > 50) {
        const fields = extractWhoisFields(cmdResult);
        const lines = [`🔍 Whois 查询: ${cleanDomain}`, `━━━━━━━━━━━━━━━━━━━━`];

        const fieldMap: [string, string][] = [
          ["domain name", "🏷️ 域名"],
          ["registrar", "🏢 注册商"],
          ["registrar url", "🔗 注册商网址"],
          ["creation date", "📅 注册日期"],
          ["updated date", "🔄 更新日期"],
          ["registry expiry date", "⏰ 到期日期"],
          ["expiration date", "⏰ 到期日期"],
          ["registrant organization", "🏢 注册组织"],
          ["registrant country", "🌍 注册国家"],
          ["name server", "🖥️ DNS 服务器"],
          ["domain status", "📋 状态"],
          ["status", "📋 状态"],
          ["dnssec", "🔒 DNSSEC"],
        ];

        for (const [key, label] of fieldMap) {
          if (fields[key]) lines.push(`${label}: ${fields[key]}`);
        }

        if (lines.length <= 2) {
          const truncated = cmdResult.slice(0, 2000);
          lines.push(truncated);
        }

        return { success: true, message: lines.join("\n"), data: fields };
      }

      const apiResult = await queryWhoisApi(cleanDomain);
      if (apiResult) {
        const lines = [`🔍 Whois 查询: ${cleanDomain}`, `━━━━━━━━━━━━━━━━━━━━`];
        for (const [k, v] of Object.entries(apiResult).slice(0, 20)) {
          lines.push(`${k}: ${v}`);
        }
        return { success: true, message: lines.join("\n"), data: apiResult };
      }

      return { success: false, message: `❌ 无法查询域名 ${cleanDomain} 的 Whois 信息` };
    } catch (err) {
      return { success: false, message: `❌ Whois 查询异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
