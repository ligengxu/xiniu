import { z } from "zod";
import type { SkillDefinition } from "../types";

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl?: number;
}

async function queryDoh(domain: string, type: string): Promise<DnsRecord[]> {
  const dohUrl = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`;
  const resp = await fetch(dohUrl, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) return [];

  const data = await resp.json() as {
    Answer?: Array<{ name?: string; type?: number; data?: string; TTL?: number }>;
  };
  if (!data.Answer) return [];

  const typeMap: Record<number, string> = {
    1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 257: "CAA",
  };

  return data.Answer.map(a => ({
    type: typeMap[a.type || 0] || String(a.type),
    name: (a.name || domain).replace(/\.$/, ""),
    value: (a.data || "").replace(/\.$/, ""),
    ttl: a.TTL,
  }));
}

async function queryDohCloudflare(domain: string, type: string): Promise<DnsRecord[]> {
  const resp = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) return [];

  const data = await resp.json() as {
    Answer?: Array<{ name?: string; type?: number; data?: string; TTL?: number }>;
  };
  if (!data.Answer) return [];

  const typeMap: Record<number, string> = {
    1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 257: "CAA",
  };

  return data.Answer.map(a => ({
    type: typeMap[a.type || 0] || String(a.type),
    name: (a.name || domain).replace(/\.$/, ""),
    value: (a.data || "").replace(/\.$/, ""),
    ttl: a.TTL,
  }));
}

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "SRV", "CAA"];

export const dnsQuerySkill: SkillDefinition = {
  name: "dns_query",
  displayName: "域名解析查询",
  description: "查询域名的 DNS 记录（A/AAAA/CNAME/MX/NS/TXT/SOA/SRV/CAA）。使用 Google 和 Cloudflare 的 DoH 服务。用户说'DNS查询'、'dns记录'、'解析记录'、'MX记录'、'A记录'、'NS记录'、'TXT记录'时使用。",
  icon: "Server",
  category: "dev",
  parameters: z.object({
    domain: z.string().describe("要查询的域名，如 example.com"),
    type: z.string().optional().describe("记录类型：A/AAAA/CNAME/MX/NS/TXT/SOA/SRV/CAA，留空则查询全部常用类型"),
  }),
  execute: async (params) => {
    const { domain, type } = params as { domain: string; type?: string };
    if (!domain?.trim()) return { success: false, message: "❌ 请提供域名" };

    const cleanDomain = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    const types = type ? [type.toUpperCase()] : RECORD_TYPES;

    try {
      const allRecords: DnsRecord[] = [];
      const errors: string[] = [];

      for (const t of types) {
        let records = await queryDoh(cleanDomain, t);
        if (records.length === 0) {
          records = await queryDohCloudflare(cleanDomain, t);
        }
        if (records.length > 0) {
          allRecords.push(...records);
        }
      }

      if (allRecords.length === 0) {
        return { success: false, message: `❌ 未找到 ${cleanDomain} 的 DNS 记录（${types.join("/")} 类型）${errors.length > 0 ? "\n" + errors.join("\n") : ""}` };
      }

      const grouped: Record<string, DnsRecord[]> = {};
      for (const r of allRecords) {
        if (!grouped[r.type]) grouped[r.type] = [];
        grouped[r.type].push(r);
      }

      const lines = [`🌐 DNS 记录查询: ${cleanDomain}`, `━━━━━━━━━━━━━━━━━━━━`];

      const typeEmoji: Record<string, string> = {
        A: "📍", AAAA: "📍", CNAME: "🔗", MX: "📧", NS: "🖥️",
        TXT: "📝", SOA: "📋", SRV: "🔌", CAA: "🔒",
      };

      for (const [t, records] of Object.entries(grouped)) {
        lines.push(`\n${typeEmoji[t] || "📎"} ${t} 记录 (${records.length}条):`);
        for (const r of records) {
          const ttlStr = r.ttl ? ` [TTL: ${r.ttl}s]` : "";
          lines.push(`  ${r.value}${ttlStr}`);
        }
      }

      lines.push(`\n📊 共 ${allRecords.length} 条记录`);

      return {
        success: true,
        message: lines.join("\n"),
        data: { domain: cleanDomain, records: allRecords, total: allRecords.length },
      };
    } catch (err) {
      return { success: false, message: `❌ DNS 查询异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
